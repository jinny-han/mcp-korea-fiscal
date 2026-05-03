import "dotenv/config";
import pLimit from "p-limit";
import pRetry, { AbortError } from "p-retry";
import CircuitBreaker from "opossum";
import { XMLParser } from "fast-xml-parser";
import { getApiSpec, type ApiSpec } from "./catalog.js";

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
  /** 서비스코드 */
  code: string;
  /** 전체 데이터 건수 (페이징 무관) */
  totalCount: number;
  /** 행 데이터 */
  rows: Record<string, unknown>[];
  /** API 응답 메시지 (예: "정상 처리되었습니다.") */
  message: string;
  /** 응답 코드 (예: "INFO-000") */
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
  /** 서비스코드 (예: "RHJDKD") */
  code: string;
  /** 검색 인자 (예: { fyr: 2024, laf_hg_nm: "서울본청" }) */
  params?: Record<string, string | number | undefined | null>;
  /** 페이지 번호 (기본 1) */
  pIndex?: number;
  /** 페이지당 건수 (기본 100, 최대 1000) */
  pSize?: number;
  /** 응답 형식 (기본 "json") */
  type?: "json" | "xml";
}

// =============== 상태 코드 분류 ===============
export function classifyResultCode(resultCode: string): {
  ok: boolean;
  empty: boolean;
  retryable: boolean;
} {
  // INFO-000: 정상 / INFO-200: 데이터 없음 (에러 아님)
  if (resultCode === "INFO-000") return { ok: true, empty: false, retryable: false };
  if (resultCode === "INFO-200") return { ok: true, empty: true, retryable: false };

  const numeric = resultCode.replace(/^[A-Z]+-/, "");
  // 5xx류 (서버/DB/SQL 오류) → 재시도
  if (["500", "600", "601"].includes(numeric)) {
    return { ok: false, empty: false, retryable: true };
  }
  // 그 외 (인증/한도/잘못된 요청) → 즉시 중단
  return { ok: false, empty: false, retryable: false };
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

  // 특수 케이스: 데이터 없음/일부 에러는 루트가 RESULT만 있음
  // 예: { "RESULT": [{ "CODE": "INFO-200", "MESSAGE": "..." }] }
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

  // 일반 케이스: 루트가 서비스코드 키
  // JSON: { [code]: [{head:[...]}, {row:[...]}] }
  // XML : { [code]: { head: ..., row: [...] } }
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
    // JSON 형식
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
    // XML 변환된 형식
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
  // 에러
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
      headers: { "User-Agent": "lofin-api-mcp/0.1.0" },
    });
  } catch (e) {
    // 네트워크 오류 → 재시도 가능
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

// =============== 서킷 브레이커 ===============
const breaker = new CircuitBreaker(rawFetch, {
  errorThresholdPercentage: 50,
  resetTimeout: 30_000,
  rollingCountTimeout: 60_000,
  rollingCountBuckets: 10,
  volumeThreshold: 5,
  // AbortError(인증/한도/잘못된 코드)는 서킷 통계에서 제외
  errorFilter: (err: unknown) => err instanceof AbortError,
});

// =============== 캐시 + 동시성 + 중복 요청 ===============
class TtlCache<T> {
  private map = new Map<string, { value: T; expiresAt: number }>();

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.map.size >= CACHE_MAX) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

const cache = new TtlCache<FiscalQueryResult>();
const inflight = new Map<string, Promise<FiscalQueryResult>>();
const limit = pLimit(CONCURRENCY);

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

  // 필수 파라미터 검증
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

  // 캐시 키: 인증키 제외
  const cacheKey = JSON.stringify({
    code: spec.code,
    p: Object.fromEntries(Object.entries(params).filter(([k]) => k !== "Key")),
  });

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const inProgress = inflight.get(cacheKey);
  if (inProgress) return inProgress;

  const promise = limit(() =>
    pRetry(() => breaker.fire(spec, params) as Promise<FiscalQueryResult>, {
      retries: RETRIES,
      minTimeout: 500,
      maxTimeout: 2000,
      randomize: true,
    }),
  )
    .then((result) => {
      cache.set(cacheKey, result);
      return result;
    })
    .finally(() => {
      inflight.delete(cacheKey);
    });

  inflight.set(cacheKey, promise);
  return promise;
}

// =============== 디버그/유틸 ===============
export function clearCache(): void {
  cache.clear();
}

export function getCacheStats(): { size: number; max: number; ttlMs: number } {
  return { size: cache.size, max: CACHE_MAX, ttlMs: CACHE_TTL_MS };
}

export function getBreakerStats(): {
  state: "closed" | "open" | "halfOpen";
  stats: { successes: number; failures: number; rejects: number };
} {
  const s = breaker.stats;
  let state: "closed" | "open" | "halfOpen" = "closed";
  if (breaker.opened) state = "open";
  else if (breaker.halfOpen) state = "halfOpen";
  return {
    state,
    stats: { successes: s.successes, failures: s.failures, rejects: s.rejects },
  };
}
