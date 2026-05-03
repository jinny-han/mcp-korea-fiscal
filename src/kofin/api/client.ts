// src/api/client.ts
import {
  type AppConfig,
  FISCAL_API_BASE_URLS,
} from "../config.js";
import { createCache, buildCacheKey } from "./cache.js";
import { parseDataGoKrXml } from "./xml-parser.js";
import pRetry, { AbortError } from "p-retry";
import pLimit from "p-limit";
import CircuitBreaker from "opossum";

export interface FiscalApiResult {
  readonly totalCount: number;
  readonly rows: Record<string, unknown>[];
}

interface OpenFiscalRawResponse {
  readonly [apiCode: string]: readonly [
    {
      readonly head: readonly [
        { readonly list_total_count: number },
        { readonly RESULT: { readonly CODE: string; readonly MESSAGE: string } },
      ];
    },
    { readonly row: readonly Record<string, unknown>[] },
  ];
}

const OPENFISCAL_ERROR_CODES: Record<string, string> = {
  "INFO-000": "정상 처리",
  "INFO-200": "해당하는 데이터가 없습니다.",
  "INFO-300": "관리자에 의해 인증키 사용이 제한되었습니다.",
  "ERROR-290": "인증키가 유효하지 않습니다.",
  "ERROR-300": "필수 값이 누락되어 있습니다.",
  "ERROR-310": "해당하는 서비스를 찾을 수 없습니다.",
  "ERROR-333": "요청위치 값의 타입이 유효하지 않습니다.",
  "ERROR-336": "데이터 요청은 한번에 최대 1,000건을 넘을 수 없습니다.",
  "ERROR-337": "일별 트래픽 제한을 넘은 호출입니다.",
  "ERROR-500": "서버 오류입니다.",
  "ERROR-600": "데이터베이스 연결 오류입니다.",
  "ERROR-601": "SQL 문장 오류입니다.",
};

// 재시도 불필요한 에러 코드 (데이터 없음, 인증 실패, 잘못된 파라미터)
const NON_RETRYABLE_CODES = new Set([
  "INFO-200",
  "INFO-300",
  "ERROR-290",
  "ERROR-300",
  "ERROR-310",
  "ERROR-333",
  "ERROR-336",
  "ERROR-337",
]);

// 동시 요청 최대 3개 제한 (ERROR-337 일별 트래픽 방지)
const limiter = pLimit(3);

// HTTP 요청 단독 함수 (서킷 브레이커가 감시하는 대상)
async function httpGet(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

// 서킷 브레이커: 연속 실패 시 30초 동안 요청 차단
const breaker = new CircuitBreaker(httpGet, {
  timeout: 16_000,                  // 16초 내 응답 없으면 실패 처리
  errorThresholdPercentage: 50,     // 실패율 50% 넘으면 차단
  resetTimeout: 30_000,             // 30초 후 자동 복구 시도
  name: "openfiscal-http",
});

breaker.on("open", () =>
  console.warn("[서킷브레이커] 열림 — API 서버 연결 불가, 30초 후 재시도"),
);
breaker.on("close", () =>
  console.info("[서킷브레이커] 닫힘 — API 서버 연결 복구"),
);
breaker.on("halfOpen", () =>
  console.info("[서킷브레이커] 반열림 — 복구 여부 확인 중"),
);

export function createFiscalClient(config: AppConfig) {
  const cache = createCache(config.cache);
  const inflight = new Map<string, Promise<FiscalApiResult>>();

  async function fetchOpenFiscal(
    apiCode: string,
    params: Record<string, string | number>,
  ): Promise<FiscalApiResult> {
    const cacheKey = buildCacheKey(["openfiscal", apiCode, ...Object.entries(params).flat().map(String)]);
    const cached = cache.get<FiscalApiResult>(cacheKey);
    if (cached) return cached;

    if (inflight.has(cacheKey)) return inflight.get(cacheKey)!;

    const promise = limiter(async (): Promise<FiscalApiResult> => {
      const qs = new URLSearchParams({
        ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
        KEY: config.apiKeys.openfiscalApiKey,
        Type: "json",
        pSize: String(config.maxPageSize),
      });
      const url = `${FISCAL_API_BASE_URLS.openFiscal}/${apiCode}?${qs.toString()}`;

      // 재시도: 네트워크/서버 오류만, 최대 2회 추가 시도 (총 3회)
      const rawText = await pRetry(
        async () => {
          if (breaker.opened) {
            throw new AbortError(
              "API 서버가 현재 응답하지 않습니다. 잠시 후 다시 시도해주세요.",
            );
          }
          return breaker.fire(url) as Promise<string>;
        },
        {
          retries: 2,
          factor: 2,
          minTimeout: 1_000,
          maxTimeout: 5_000,
          onFailedAttempt: (error) => {
            if (error instanceof AbortError) return; // 재시도 안 함
            console.warn(
              `[재시도] ${apiCode} — ${error.attemptNumber}번째 실패 (남은 횟수: ${error.retriesLeft}): ${String(error)}`,
            );
          },
        },
      );

      const data = JSON.parse(JSON.parse(rawText)) as OpenFiscalRawResponse;

      if (!(apiCode in data)) {
        const flat = data as unknown as { RESULT?: { CODE: string; MESSAGE: string } };
        const code = flat.RESULT?.CODE ?? "UNKNOWN";
        const msg = flat.RESULT?.MESSAGE ?? "알 수 없는 오류";
        const known = OPENFISCAL_ERROR_CODES[code];
        throw new Error(known ?? msg);
      }

      const [headBlock, rowBlock] = data[apiCode];
      const resultCode = headBlock.head[1].RESULT.CODE;
      const resultMessage = headBlock.head[1].RESULT.MESSAGE;

      if (resultCode !== "INFO-000") {
        const known = OPENFISCAL_ERROR_CODES[resultCode];
        const errorMsg = known ?? resultMessage;
        // 재시도 불필요한 API 오류는 AbortError로 즉시 종료
        if (NON_RETRYABLE_CODES.has(resultCode)) {
          throw new AbortError(errorMsg);
        }
        throw new Error(errorMsg);
      }

      const result: FiscalApiResult = {
        totalCount: headBlock.head[0].list_total_count,
        rows: rowBlock.row ? [...rowBlock.row] : [],
      };

      const ttl = config.cache.ttlExecution;
      cache.set(cacheKey, result, ttl);
      return result;
    });

    inflight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(cacheKey);
    }
  }

  async function fetchDataGoKr(
    serviceCode: string,
    params: Record<string, string | number>,
  ): Promise<FiscalApiResult> {
    if (!config.apiKeys.dataGoKrApiKey) {
      throw new Error("DATAGOKR_API_KEY가 설정되지 않았습니다.");
    }
    const dataGoKrApiKey = config.apiKeys.dataGoKrApiKey;
    const cacheKey = buildCacheKey(["datagokr", serviceCode, ...Object.entries(params).flat().map(String)]);
    const cached = cache.get<FiscalApiResult>(cacheKey);
    if (cached) return cached;

    if (inflight.has(cacheKey)) return inflight.get(cacheKey)!;

    const promise = (async (): Promise<FiscalApiResult> => {
      const qs = new URLSearchParams({
        ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
        serviceKey: dataGoKrApiKey,
        numOfRows: String(config.maxPageSize),
      });
      const url = `${FISCAL_API_BASE_URLS.dataGoKr}/${serviceCode}?${qs.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
      const xml = await res.text();
      const result = parseDataGoKrXml(xml);
      cache.set(cacheKey, result, config.cache.ttlBudget);
      return result;
    })();

    inflight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(cacheKey);
    }
  }

  async function fetchNaboStats(
    statCode: string,
    params: Record<string, string | number>,
  ): Promise<FiscalApiResult> {
    if (!config.apiKeys.nabostatsApiKey) {
      throw new Error("NABOSTATS_API_KEY가 설정되지 않았습니다.");
    }
    const nabostatsApiKey = config.apiKeys.nabostatsApiKey;
    const cacheKey = buildCacheKey(["nabostats", statCode, ...Object.entries(params).flat().map(String)]);
    const cached = cache.get<FiscalApiResult>(cacheKey);
    if (cached) return cached;

    if (inflight.has(cacheKey)) return inflight.get(cacheKey)!;

    const promise = (async (): Promise<FiscalApiResult> => {
      const qs = new URLSearchParams({
        ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
        apiKey: nabostatsApiKey,
      });
      const url = `${FISCAL_API_BASE_URLS.naboStats}/${statCode}?${qs.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
      const data = await res.json() as { totalCount?: number; data?: Record<string, unknown>[] };
      const result: FiscalApiResult = {
        totalCount: data.totalCount ?? data.data?.length ?? 0,
        rows: data.data ?? [],
      };
      cache.set(cacheKey, result, config.cache.ttlBudget);
      return result;
    })();

    inflight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(cacheKey);
    }
  }

  return { fetchOpenFiscal, fetchDataGoKr, fetchNaboStats };
}
