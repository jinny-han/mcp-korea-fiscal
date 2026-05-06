import "dotenv/config";
import { XMLParser } from "fast-xml-parser";
import { getApiSpec, type ApiSpec } from "./catalog.js";
import {
  createTtlCache,
  createResilientFetcher,
  classifyResultCode,
  AbortError,
} from "../common/index.js";

// =============== 설정 ===============
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 100;
const CONCURRENCY = 3;
const RETRIES = 2;

// =============== 인증키 ===============
let cachedApiKey: string | null = null;

export function getApiKey(): string {
  if (cachedApiKey) return cachedApiKey;
  const key = process.env.LOFIN_API_KEY;
  if (!key || key === "your_api_key_here" || key.trim() === "") {
    throw new Error(
      "LOFIN_API_KEY not set. Add it to .env or environment. " +
        "Get one at https://lofin.mois.go.kr/portal/user/openApi.do",
    );
  }
  cachedApiKey = key.trim();
  return cachedApiKey;
}

// =============== 타입 ===============
export interface FiscalQueryResult {
  code: string;
  totalCount: number;
  rows: Record<string, unknown>[];
  message: string;
  resultCode: string;
}

export class FiscalApiError extends Error {
  constructor(
    public readonly resultCode: string,
    public readonly resultMessage: string,
    public readonly retryable: boolean,
  ) {
    super(`${resultCode}: ${resultMessage}`);
    this.name = "FiscalApiError";
  }
}

export interface CallParams {
  code: string;
  params?: Record<string, string | number | undefined | null>;
  pIndex?: number;
  pSize?: number;
  type?: "json" | "xml";
}

// =============== 응답 파싱 ===============
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true,
  isArray: (name) => name === "row",
});

interface RawHead {
  list_total_count?: number;
  RESULT?: { CODE?: string; MESSAGE?: string };
}

function parseResponse(serviceCode: string, body: string, type: string): FiscalQueryResult {
  let payload: unknown;
  if (type.toLowerCase() === "xml") {
    payload = xmlParser.parse(body);
  } else {
    try {
      payload = JSON.parse(body);
    } catch {
      payload = xmlParser.parse(body);
    }
  }

  const payloadRec = (payload ?? {}) as Record<string, unknown>;

  if (!(serviceCode in payloadRec) && "RESULT" in payloadRec) {
    let resultCode = "UNKNOWN";
    let resultMessage = "";
    const r = payloadRec.RESULT;
    if (Array.isArray(r) && r.length > 0) {
      const first = r[0] as Record<string, unknown>;
      resultCode = String(first.CODE ?? "UNKNOWN");
      resultMessage = String(first.MESSAGE ?? "");
    } else if (typeof r === "object" && r !== null) {
      const obj = r as Record<string, unknown>;
      resultCode = String(obj.CODE ?? "UNKNOWN");
      resultMessage = String(obj.MESSAGE ?? "");
    }
    const cls = classifyResultCode(resultCode);
    if (cls.ok) {
      return { code: serviceCode, totalCount: 0, rows: [], message: resultMessage, resultCode };
    }
    const err = new FiscalApiError(resultCode, resultMessage, cls.retryable);
    if (!cls.retryable) throw new AbortError(err);
    throw err;
  }

  const root = payloadRec[serviceCode];
  if (root === undefined) {
    throw new Error(
      `Unexpected response shape: missing root key "${serviceCode}". Body preview: ${body.slice(0, 200)}`,
    );
  }

  let totalCount = 0;
  let resultCode = "UNKNOWN";
  let resultMessage = "";
  let rows: Record<string, unknown>[] = [];

  if (Array.isArray(root)) {
    for (const entry of root as Array<Record<string, unknown>>) {
      if ("head" in entry && Array.isArray(entry.head)) {
        for (const h of entry.head as RawHead[]) {
          if ("list_total_count" in h && h.list_total_count !== undefined) {
            totalCount = Number(h.list_total_count);
          }
          if ("RESULT" in h && h.RESULT) {
            resultCode = String(h.RESULT.CODE ?? "UNKNOWN");
            resultMessage = String(h.RESULT.MESSAGE ?? "");
          }
        }
      }
      if ("row" in entry && Array.isArray(entry.row)) {
        rows = entry.row as Record<string, unknown>[];
      }
    }
  } else if (typeof root === "object" && root !== null) {
    const r = root as Record<string, unknown>;
    const head = r.head as RawHead | undefined;
    if (head) {
      if (head.list_total_count !== undefined) totalCount = Number(head.list_total_count);
      if (head.RESULT) {
        resultCode = String(head.RESULT.CODE ?? "UNKNOWN");
        resultMessage = String(head.RESULT.MESSAGE ?? "");
      }
    }
    if (Array.isArray(r.row)) {
      rows = r.row as Record<string, unknown>[];
    }
  }

  const cls = classifyResultCode(resultCode);
  if (cls.ok) {
    return {
      code: serviceCode,
      totalCount,
      rows: cls.empty ? [] : rows,
      message: resultMessage,
      resultCode,
    };
  }
  const err = new FiscalApiError(resultCode, resultMessage, cls.retryable);
  if (!cls.retryable) throw new AbortError(err);
  throw err;
}

// =============== HTTP 호출 ===============
async function rawFetch(spec: ApiSpec, params: Record<string, string>): Promise<FiscalQueryResult> {
  const url = new URL(spec.endpoint);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { "User-Agent": "mcp-korea-fiscal/0.1.0" },
    });
  } catch (e) {
    throw new Error(`Network error: ${(e as Error).message}`);
  }

  if (!res.ok) {
    const httpErr = new Error(`HTTP ${res.status}: ${res.statusText}`);
    if (res.status >= 500) throw httpErr;
    throw new AbortError(httpErr);
  }

  const body = await res.text();
  return parseResponse(spec.code, body, params.Type ?? "json");
}

// =============== 캐시 + 동시성 + 중복 요청 + 서킷 ===============
const cache = createTtlCache<FiscalQueryResult>({
  ttlMs: CACHE_TTL_MS,
  max: CACHE_MAX,
});

const fetcher = createResilientFetcher({
  retries: RETRIES,
  concurrency: CONCURRENCY,
  breakerName: "lofin-http",
  retryDelayMin: 500,
  retryDelayMax: 2_000,
});

// =============== 메인 진입점 ===============
export async function fiscalQuery(opts: CallParams): Promise<FiscalQueryResult> {
  const spec = getApiSpec(opts.code);
  if (!spec) {
    throw new FiscalApiError(
      "ERROR-310",
      `해당하는 서비스를 찾을 수 없습니다. svcCd="${opts.code}". searchCatalog로 가능한 코드를 확인하세요.`,
      false,
    );
  }

  const userParams = opts.params ?? {};
  const missing = spec.searchParams
    .filter((p) => p.required && (userParams[p.name] === undefined || userParams[p.name] === ""))
    .map((p) => p.name);
  if (missing.length > 0) {
    throw new FiscalApiError(
      "ERROR-300",
      `필수 검색 파라미터가 누락되었습니다: ${missing.join(", ")}`,
      false,
    );
  }

  const params: Record<string, string> = {
    Key: getApiKey(),
    Type: opts.type ?? "json",
    pIndex: String(opts.pIndex ?? 1),
    pSize: String(Math.min(Math.max(opts.pSize ?? 100, 1), 1000)),
  };

  for (const [k, v] of Object.entries(userParams)) {
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      params[k] = String(v);
    }
  }

  const cacheKey = JSON.stringify({
    code: spec.code,
    p: Object.fromEntries(Object.entries(params).filter(([k]) => k !== "Key")),
  });

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const result = await fetcher.run(cacheKey, () => rawFetch(spec, params));
  cache.set(cacheKey, result);
  return result;
}

// =============== 디버그/유틸 ===============
export function clearCache(): void {
  cache.clear();
}

export function getCacheStats(): { size: number; max: number; ttlMs: number } {
  return { size: cache.size(), max: CACHE_MAX, ttlMs: CACHE_TTL_MS };
}

export function getBreakerStats(): { state: "closed" | "open" | "halfOpen" } {
  return { state: fetcher.getBreakerState() };
}
