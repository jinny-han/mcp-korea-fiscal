import { type AppConfig, FISCAL_API_BASE_URLS } from "../config.js";
import { parseDataGoKrXml } from "./xml-parser.js";
import {
  createTtlCache,
  createResilientFetcher,
  classifyResultCode,
  AbortError,
} from "../../common/index.js";

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

const OPENFISCAL_ERROR_MESSAGES: Record<string, string> = {
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

function buildKey(parts: (string | number)[]): string {
  return parts.map(String).join(":");
}

export function createFiscalClient(config: AppConfig) {
  const cache = createTtlCache<FiscalApiResult>({
    ttlMs: config.cache.ttlExecution * 1000,
    max: 200,
    enabled: config.cache.enabled,
  });

  const fetcher = createResilientFetcher({
    retries: 2,
    concurrency: 3,
    breakerName: "kofin-http",
    retryDelayMin: 1_000,
    retryDelayMax: 5_000,
    timeout: 16_000,
  });

  async function httpGetText(url: string): Promise<string> {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return res.text();
  }

  async function fetchOpenFiscal(
    apiCode: string,
    params: Record<string, string | number>,
  ): Promise<FiscalApiResult> {
    const cacheKey = buildKey(["openfiscal", apiCode, ...Object.entries(params).flat().map(String)]);
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const result = await fetcher.run(cacheKey, async (): Promise<FiscalApiResult> => {
      const qs = new URLSearchParams({
        ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
        KEY: config.apiKeys.openfiscalApiKey,
        Type: "json",
        pSize: String(config.maxPageSize),
      });
      const url = `${FISCAL_API_BASE_URLS.openFiscal}/${apiCode}?${qs.toString()}`;

      const rawText = await httpGetText(url);
      const data = JSON.parse(JSON.parse(rawText)) as OpenFiscalRawResponse;

      if (!(apiCode in data)) {
        const flat = data as unknown as { RESULT?: { CODE: string; MESSAGE: string } };
        const code = flat.RESULT?.CODE ?? "UNKNOWN";
        const msg = flat.RESULT?.MESSAGE ?? "알 수 없는 오류";
        const known = OPENFISCAL_ERROR_MESSAGES[code];
        throw new AbortError(known ?? msg);
      }

      const [headBlock, rowBlock] = data[apiCode];
      const resultCode = headBlock.head[1].RESULT.CODE;
      const resultMessage = headBlock.head[1].RESULT.MESSAGE;

      const cls = classifyResultCode(resultCode);
      if (!cls.ok) {
        const errorMsg = OPENFISCAL_ERROR_MESSAGES[resultCode] ?? resultMessage;
        if (!cls.retryable) throw new AbortError(errorMsg);
        throw new Error(errorMsg);
      }

      return {
        totalCount: cls.empty ? 0 : headBlock.head[0].list_total_count,
        rows: cls.empty ? [] : rowBlock.row ? [...rowBlock.row] : [],
      };
    });

    cache.set(cacheKey, result);
    return result;
  }

  async function fetchDataGoKr(
    serviceCode: string,
    params: Record<string, string | number>,
  ): Promise<FiscalApiResult> {
    if (!config.apiKeys.dataGoKrApiKey) {
      throw new Error("DATAGOKR_API_KEY가 설정되지 않았습니다.");
    }
    const dataGoKrApiKey = config.apiKeys.dataGoKrApiKey;
    const cacheKey = buildKey(["datagokr", serviceCode, ...Object.entries(params).flat().map(String)]);
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const result = await fetcher.run(cacheKey, async (): Promise<FiscalApiResult> => {
      const qs = new URLSearchParams({
        ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
        serviceKey: dataGoKrApiKey,
        numOfRows: String(config.maxPageSize),
      });
      const url = `${FISCAL_API_BASE_URLS.dataGoKr}/${serviceCode}?${qs.toString()}`;
      const xml = await httpGetText(url);
      return parseDataGoKrXml(xml);
    });

    cache.set(cacheKey, result, config.cache.ttlBudget * 1000);
    return result;
  }

  async function fetchNaboStats(
    statCode: string,
    params: Record<string, string | number>,
  ): Promise<FiscalApiResult> {
    if (!config.apiKeys.nabostatsApiKey) {
      throw new Error("NABOSTATS_API_KEY가 설정되지 않았습니다.");
    }
    const nabostatsApiKey = config.apiKeys.nabostatsApiKey;
    const cacheKey = buildKey(["nabostats", statCode, ...Object.entries(params).flat().map(String)]);
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const result = await fetcher.run(cacheKey, async (): Promise<FiscalApiResult> => {
      const qs = new URLSearchParams({
        ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
        apiKey: nabostatsApiKey,
      });
      const url = `${FISCAL_API_BASE_URLS.naboStats}/${statCode}?${qs.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
      const data = (await res.json()) as { totalCount?: number; data?: Record<string, unknown>[] };
      return {
        totalCount: data.totalCount ?? data.data?.length ?? 0,
        rows: data.data ?? [],
      };
    });

    cache.set(cacheKey, result, config.cache.ttlBudget * 1000);
    return result;
  }

  return { fetchOpenFiscal, fetchDataGoKr, fetchNaboStats };
}
