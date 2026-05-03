// src/config.ts

export interface FiscalApiKeyConfig {
  readonly openfiscalApiKey: string;
  readonly dataGoKrApiKey: string | undefined;
  readonly nabostatsApiKey: string | undefined;
}

export interface ServerConfig {
  readonly transport: "stdio";
  readonly port: number;
  readonly logLevel: "debug" | "info" | "warn" | "error";
}

export interface CacheConfig {
  readonly enabled: boolean;
  readonly ttlBudget: number;       // 예산·결산 확정치 TTL (초)
  readonly ttlProgram: number;      // 재정사업 목록 TTL (초)
  readonly ttlExecution: number;    // 집행실적 변동 TTL (초)
}

export interface AppConfig {
  readonly apiKeys: FiscalApiKeyConfig;
  readonly server: ServerConfig;
  readonly cache: CacheConfig;
  readonly defaultPageSize: number;
  readonly maxPageSize: number;
}

function requireEnv(name: string, guidance: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `환경 변수 ${name}이(가) 설정되지 않았습니다.\n설정 방법: ${guidance}`,
    );
  }
  return value.trim();
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value.trim() === "") return undefined;
  return value.trim();
}

function envOrDefault(name: string, defaultValue: string): string {
  return optionalEnv(name) ?? defaultValue;
}

function envIntOrDefault(name: string, defaultValue: number): number {
  const raw = optionalEnv(name);
  if (raw === undefined) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`환경 변수 ${name}의 값 "${raw}"은(는) 유효한 정수가 아닙니다.`);
  }
  return parsed;
}

function envBoolOrDefault(name: string, defaultValue: boolean): boolean {
  const raw = optionalEnv(name);
  if (raw === undefined) return defaultValue;
  return raw === "true" || raw === "1";
}

function envEnum<T extends string>(
  name: string,
  allowed: readonly T[],
  defaultValue: T,
): T {
  const raw = optionalEnv(name);
  if (raw === undefined) return defaultValue;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new Error(
      `환경 변수 ${name}의 값 "${raw}"은(는) 유효하지 않습니다. 허용값: ${allowed.join(", ")}`,
    );
  }
  return raw as T;
}

export function loadConfig(): AppConfig {
  return {
    apiKeys: {
      openfiscalApiKey: requireEnv(
        "OPENFISCAL_API_KEY",
        "https://openfiscaldata.go.kr → 로그인 → 마이페이지 → OpenAPI 신청",
      ),
      dataGoKrApiKey: optionalEnv("DATAGOKR_API_KEY"),
      nabostatsApiKey: optionalEnv("NABOSTATS_API_KEY"),
    },
    server: {
      transport: envEnum("MCP_TRANSPORT", ["stdio"] as const, "stdio"),
      port: envIntOrDefault("MCP_PORT", 3000),
      logLevel: envEnum("LOG_LEVEL", ["debug", "info", "warn", "error"] as const, "info"),
    },
    cache: {
      enabled: envBoolOrDefault("CACHE_ENABLED", true),
      ttlBudget: envIntOrDefault("CACHE_TTL_BUDGET", 86400),
      ttlProgram: envIntOrDefault("CACHE_TTL_PROGRAM", 21600),
      ttlExecution: envIntOrDefault("CACHE_TTL_EXECUTION", 3600),
    },
    defaultPageSize: envIntOrDefault("DEFAULT_PAGE_SIZE", 20),
    maxPageSize: envIntOrDefault("MAX_PAGE_SIZE", 100),
  };
}

export const FISCAL_API_BASE_URLS = {
  openFiscal: "https://openapi.openfiscaldata.go.kr",
  dataGoKr: "https://apis.data.go.kr",
  naboStats: "https://www.nabostats.go.kr/openapi",
} as const;
