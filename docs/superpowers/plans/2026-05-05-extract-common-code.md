# Extract Common Code to `src/common/` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared cache / HTTP-resilience / inflight-dedup / result-code-classification logic from `src/kofin/api/` and `src/lofin/client.ts` into `src/common/`, so both subsystems use one battle-tested implementation instead of two divergent ones.

**Architecture:** Three new modules under `src/common/`:
- `cache.ts` — generic TTL+LRU cache, replaces both subsystems' caches
- `resilient-fetch.ts` — composes circuit breaker + retry + concurrency limit + inflight dedup over an injectable fetch function
- `result-code.ts` — classifies `INFO-XXX`/`ERROR-XXX` codes into `{ ok, empty, retryable }`

Subsystems keep their own response-shape parsing and per-API key/URL handling — only the resilience and caching layers are unified.

**Tech Stack:** TypeScript, vitest, opossum (circuit breaker), p-retry, p-limit. No new dependencies.

---

## Pre-flight

This plan assumes:
- Local clone at `/tmp/mcp-korea-fiscal/` with current main checked out, OR re-cloned via `git clone https://github.com/jinny-han/mcp-korea-fiscal.git`
- `npm install` already done (or will be done)
- Working directory: repo root

If `/tmp/mcp-korea-fiscal/` is gone (macOS cleaned `/tmp`), re-clone first:

```bash
git clone https://github.com/jinny-han/mcp-korea-fiscal.git /tmp/mcp-korea-fiscal
cd /tmp/mcp-korea-fiscal
npm install
git config user.email "kiki772@gmail.com"
git config user.name "Haejin Han"
```

## File Structure

**New files:**
- `src/common/cache.ts` — TTL+LRU cache implementation
- `src/common/resilient-fetch.ts` — composed retry/breaker/limit/dedup helper
- `src/common/result-code.ts` — code classifier
- `src/common/index.ts` — barrel re-exports
- `tests/common/cache.test.ts`
- `tests/common/resilient-fetch.test.ts`
- `tests/common/result-code.test.ts`
- `vitest.config.ts` — at repo root

**Modified files:**
- `src/kofin/api/cache.ts` — delete (replaced by common)
- `src/kofin/api/client.ts` — refactor to use common modules
- `src/lofin/client.ts` — refactor to use common modules
- `package.json` — verify `test` script wired up
- `CLAUDE.md` — update follow-ups list (mark this one done)

---

## Task 1: Add vitest config and verify test runner works

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/sanity.test.ts`

- [ ] **Step 1: Create vitest config**

`vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
```

- [ ] **Step 2: Create one-line sanity test**

`tests/sanity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("test runner", () => {
  it("works", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests to verify config works**

```bash
cd /tmp/mcp-korea-fiscal && npm test
```

Expected: `1 passed | 0 failed`. If config error, fix `vitest.config.ts` until green.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts tests/sanity.test.ts
git commit -m "Add vitest config and sanity test

Co-Authored-By: yangheeseok1 <yangheeseok@kei.re.kr>"
```

---

## Task 2: TDD — common TTL+LRU cache (tests first)

**Files:**
- Create: `tests/common/cache.test.ts`

- [ ] **Step 1: Write failing tests for TTL+LRU cache**

`tests/common/cache.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTtlCache, type TtlCache } from "../../src/common/cache.js";

describe("createTtlCache", () => {
  let cache: TtlCache<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = createTtlCache<string>({ ttlMs: 1000, max: 3 });
  });

  it("returns undefined for missing keys", () => {
    expect(cache.get("missing")).toBeUndefined();
  });

  it("returns cached value before TTL expires", () => {
    cache.set("k", "v");
    expect(cache.get("k")).toBe("v");
  });

  it("returns undefined after TTL expires", () => {
    cache.set("k", "v");
    vi.advanceTimersByTime(1001);
    expect(cache.get("k")).toBeUndefined();
  });

  it("evicts oldest entry when max reached (LRU)", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("d", "4"); // exceeds max=3, should evict "a"
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
    expect(cache.get("d")).toBe("4");
  });

  it("get() refreshes recency (LRU touches)", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.get("a"); // touch a
    cache.set("d", "4"); // should evict b (oldest non-touched)
    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBeUndefined();
  });

  it("clear() empties cache", () => {
    cache.set("k", "v");
    cache.clear();
    expect(cache.get("k")).toBeUndefined();
  });

  it("respects per-entry TTL override", () => {
    cache.set("k", "v", 500); // override default 1000
    vi.advanceTimersByTime(501);
    expect(cache.get("k")).toBeUndefined();
  });

  it("disabled cache returns undefined and does not store", () => {
    const off = createTtlCache<string>({ ttlMs: 1000, max: 3, enabled: false });
    off.set("k", "v");
    expect(off.get("k")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/common/cache.test.ts
```

Expected: FAIL with "Cannot find module '../../src/common/cache.js'".

---

## Task 3: Implement common TTL+LRU cache

**Files:**
- Create: `src/common/cache.ts`

- [ ] **Step 1: Implement cache**

`src/common/cache.ts`:

```typescript
export interface TtlCacheOptions {
  /** Default TTL in milliseconds. */
  ttlMs: number;
  /** Maximum number of entries; oldest evicted when exceeded. */
  max: number;
  /** When false, get() always returns undefined and set() is a no-op. Default true. */
  enabled?: boolean;
}

export interface TtlCache<T> {
  get(key: string): T | undefined;
  /** Optional `ttlMs` overrides the default. */
  set(key: string, value: T, ttlMs?: number): void;
  invalidate(key: string): void;
  clear(): void;
  size(): number;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export function createTtlCache<T>(opts: TtlCacheOptions): TtlCache<T> {
  const { ttlMs, max, enabled = true } = opts;
  const map = new Map<string, Entry<T>>();

  return {
    get(key) {
      if (!enabled) return undefined;
      const entry = map.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiresAt) {
        map.delete(key);
        return undefined;
      }
      // LRU: re-insert to move to end
      map.delete(key);
      map.set(key, entry);
      return entry.value;
    },
    set(key, value, customTtl) {
      if (!enabled) return;
      if (map.size >= max && !map.has(key)) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      map.set(key, {
        value,
        expiresAt: Date.now() + (customTtl ?? ttlMs),
      });
    },
    invalidate(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    size() {
      return map.size;
    },
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npm test -- tests/common/cache.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/common/cache.ts tests/common/cache.test.ts
git commit -m "Add common TTL+LRU cache

Generic cache used by both kofin and lofin subsystems. Supports
default TTL, per-entry TTL override, LRU eviction at max capacity,
and a disabled mode for testing.

Co-Authored-By: yangheeseok1 <yangheeseok@kei.re.kr>"
```

---

## Task 4: TDD — common result-code classifier

**Files:**
- Create: `tests/common/result-code.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/common/result-code.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyResultCode } from "../../src/common/result-code.js";

describe("classifyResultCode", () => {
  it("INFO-000 is ok, not empty, not retryable", () => {
    expect(classifyResultCode("INFO-000")).toEqual({
      ok: true,
      empty: false,
      retryable: false,
    });
  });

  it("INFO-200 is ok and marked empty (no data, not error)", () => {
    expect(classifyResultCode("INFO-200")).toEqual({
      ok: true,
      empty: true,
      retryable: false,
    });
  });

  it("INFO-300 (admin-restricted key) is non-ok, non-retryable", () => {
    const r = classifyResultCode("INFO-300");
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(false);
  });

  it.each([
    ["ERROR-290", "auth"],
    ["ERROR-300", "missing required"],
    ["ERROR-310", "unknown service"],
    ["ERROR-333", "bad position type"],
    ["ERROR-336", "over 1000 limit"],
    ["ERROR-337", "daily traffic"],
  ])("%s (%s) is non-ok and non-retryable", (code) => {
    const r = classifyResultCode(code);
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(false);
  });

  it.each([["ERROR-500"], ["ERROR-600"], ["ERROR-601"]])(
    "%s (server/db) is retryable",
    (code) => {
      const r = classifyResultCode(code);
      expect(r.ok).toBe(false);
      expect(r.retryable).toBe(true);
    },
  );

  it("unknown code defaults to non-ok, non-retryable", () => {
    const r = classifyResultCode("ERROR-999");
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/common/result-code.test.ts
```

Expected: FAIL with "Cannot find module".

---

## Task 5: Implement result-code classifier

**Files:**
- Create: `src/common/result-code.ts`

- [ ] **Step 1: Implement classifier**

`src/common/result-code.ts`:

```typescript
export interface ResultCodeClassification {
  /** True if this code represents a successful response (incl. empty). */
  ok: boolean;
  /** True if response is INFO-200 "no data" — successful but no rows. */
  empty: boolean;
  /** True if the error is transient (server/db/sql) and worth retrying. */
  retryable: boolean;
}

/**
 * Classifies Korean public-fiscal API result codes.
 *
 * Both 열린재정 (kofin) and 지방재정365 (lofin) follow the same
 * INFO-XXX/ERROR-XXX convention. This is a single source of truth.
 */
export function classifyResultCode(resultCode: string): ResultCodeClassification {
  if (resultCode === "INFO-000") {
    return { ok: true, empty: false, retryable: false };
  }
  if (resultCode === "INFO-200") {
    return { ok: true, empty: true, retryable: false };
  }
  // 5xx-class server/db/sql errors are transient
  const numeric = resultCode.replace(/^[A-Z]+-/, "");
  if (["500", "600", "601"].includes(numeric)) {
    return { ok: false, empty: false, retryable: true };
  }
  // All other codes (auth, limits, missing params, unknown) are terminal
  return { ok: false, empty: false, retryable: false };
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npm test -- tests/common/result-code.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/common/result-code.ts tests/common/result-code.test.ts
git commit -m "Add common result-code classifier

Unified INFO-XXX/ERROR-XXX classification used by both subsystems
to decide retry/abort behavior consistently.

Co-Authored-By: yangheeseok1 <yangheeseok@kei.re.kr>"
```

---

## Task 6: TDD — common resilient-fetch helper (composes breaker + retry + concurrency + dedup)

**Files:**
- Create: `tests/common/resilient-fetch.test.ts`

This is the most non-trivial helper. We test it with an injectable mock fetch.

- [ ] **Step 1: Write failing tests**

`tests/common/resilient-fetch.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createResilientFetcher } from "../../src/common/resilient-fetch.js";

describe("createResilientFetcher", () => {
  beforeEach(() => {
    vi.useRealTimers(); // p-retry uses real timers internally
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the value from the underlying fetch on success", async () => {
    const fetcher = createResilientFetcher({
      retries: 0,
      concurrency: 1,
      breakerName: "test-1",
    });
    const result = await fetcher.run("k1", async () => "ok");
    expect(result).toBe("ok");
  });

  it("retries on retryable error and eventually succeeds", async () => {
    const fetcher = createResilientFetcher({
      retries: 2,
      concurrency: 1,
      breakerName: "test-2",
      retryDelayMin: 1,
      retryDelayMax: 5,
    });
    let attempts = 0;
    const result = await fetcher.run("k2", async () => {
      attempts++;
      if (attempts < 2) throw new Error("transient");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("does not retry when AbortError is thrown", async () => {
    const { AbortError } = await import("p-retry");
    const fetcher = createResilientFetcher({
      retries: 3,
      concurrency: 1,
      breakerName: "test-3",
      retryDelayMin: 1,
      retryDelayMax: 5,
    });
    let attempts = 0;
    await expect(
      fetcher.run("k3", async () => {
        attempts++;
        throw new AbortError("auth failed");
      }),
    ).rejects.toThrow("auth failed");
    expect(attempts).toBe(1);
  });

  it("dedups concurrent identical requests via inflight cache", async () => {
    const fetcher = createResilientFetcher({
      retries: 0,
      concurrency: 5,
      breakerName: "test-4",
    });
    let invocations = 0;
    const work = async () => {
      invocations++;
      await new Promise((r) => setTimeout(r, 10));
      return "v";
    };
    const [r1, r2, r3] = await Promise.all([
      fetcher.run("same-key", work),
      fetcher.run("same-key", work),
      fetcher.run("same-key", work),
    ]);
    expect(r1).toBe("v");
    expect(r2).toBe("v");
    expect(r3).toBe("v");
    expect(invocations).toBe(1);
  });

  it("different keys do NOT share inflight", async () => {
    const fetcher = createResilientFetcher({
      retries: 0,
      concurrency: 5,
      breakerName: "test-5",
    });
    let invocations = 0;
    const work = async () => {
      invocations++;
      return "v";
    };
    await Promise.all([
      fetcher.run("a", work),
      fetcher.run("b", work),
    ]);
    expect(invocations).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/common/resilient-fetch.test.ts
```

Expected: FAIL with "Cannot find module".

---

## Task 7: Implement resilient-fetch

**Files:**
- Create: `src/common/resilient-fetch.ts`

- [ ] **Step 1: Implement helper**

`src/common/resilient-fetch.ts`:

```typescript
import pRetry, { AbortError } from "p-retry";
import pLimit from "p-limit";
import CircuitBreaker from "opossum";

export interface ResilientFetcherOptions {
  /** Max number of retries on retryable errors (excluding the first attempt). */
  retries: number;
  /** Max concurrent in-flight `run()` calls. */
  concurrency: number;
  /** Unique name for the underlying circuit breaker (used in metrics). */
  breakerName: string;
  /** Min retry backoff in ms. Default 500. */
  retryDelayMin?: number;
  /** Max retry backoff in ms. Default 5000. */
  retryDelayMax?: number;
  /** Circuit-breaker error threshold percent. Default 50. */
  errorThresholdPercentage?: number;
  /** Circuit-breaker reset timeout in ms. Default 30000. */
  resetTimeout?: number;
  /** Total timeout per attempt in ms. Default 16000. */
  timeout?: number;
}

export interface ResilientFetcher {
  /**
   * Execute `work()` under retry / circuit-breaker / concurrency / inflight-dedup.
   * Identical concurrent calls with the same `key` share one promise.
   *
   * Throw `AbortError` from `work()` to skip retries for terminal errors.
   */
  run<T>(key: string, work: () => Promise<T>): Promise<T>;
  /** Inspect breaker state (for metrics/debug). */
  getBreakerState(): "closed" | "open" | "halfOpen";
}

export { AbortError };

export function createResilientFetcher(opts: ResilientFetcherOptions): ResilientFetcher {
  const {
    retries,
    concurrency,
    breakerName,
    retryDelayMin = 500,
    retryDelayMax = 5_000,
    errorThresholdPercentage = 50,
    resetTimeout = 30_000,
    timeout = 16_000,
  } = opts;

  // The breaker wraps a generic "do the work" function. Since each call's work
  // is different, we curry: opossum gets a fixed shape (ctx -> Promise<unknown>)
  // and we pass {work} as the ctx.
  const breaker = new CircuitBreaker(
    async (ctx: { work: () => Promise<unknown> }) => ctx.work(),
    {
      timeout,
      errorThresholdPercentage,
      resetTimeout,
      name: breakerName,
      // AbortError = terminal; do not count against breaker stats
      errorFilter: (err: unknown) => err instanceof AbortError,
    },
  );

  const limit = pLimit(concurrency);
  const inflight = new Map<string, Promise<unknown>>();

  return {
    run<T>(key: string, work: () => Promise<T>): Promise<T> {
      const existing = inflight.get(key);
      if (existing) return existing as Promise<T>;

      const promise = limit(() =>
        pRetry(() => breaker.fire({ work }) as Promise<T>, {
          retries,
          minTimeout: retryDelayMin,
          maxTimeout: retryDelayMax,
          randomize: true,
        }),
      ).finally(() => {
        inflight.delete(key);
      });

      inflight.set(key, promise);
      return promise;
    },
    getBreakerState() {
      if (breaker.opened) return "open";
      if (breaker.halfOpen) return "halfOpen";
      return "closed";
    },
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npm test -- tests/common/resilient-fetch.test.ts
```

Expected: all 5 tests pass. If any time-related test fails flakily, increase the test's `setTimeout` delay or `retryDelayMin/Max`.

- [ ] **Step 3: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/common/resilient-fetch.ts tests/common/resilient-fetch.test.ts
git commit -m "Add common resilient-fetch helper

Composes p-retry + opossum circuit breaker + p-limit concurrency
+ inflight-key dedup. Both subsystems will use this instead of
maintaining their own retry/breaker stacks.

AbortError(p-retry) is the terminal-error signal — work() throws
AbortError to skip retries, otherwise default retry behavior applies.

Co-Authored-By: yangheeseok1 <yangheeseok@kei.re.kr>"
```

---

## Task 8: Add `src/common/index.ts` barrel

**Files:**
- Create: `src/common/index.ts`

- [ ] **Step 1: Create barrel**

`src/common/index.ts`:

```typescript
export { createTtlCache, type TtlCache, type TtlCacheOptions } from "./cache.js";
export {
  createResilientFetcher,
  type ResilientFetcher,
  type ResilientFetcherOptions,
  AbortError,
} from "./resilient-fetch.js";
export {
  classifyResultCode,
  type ResultCodeClassification,
} from "./result-code.js";
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/common/index.ts
git commit -m "Add src/common/ barrel

Co-Authored-By: yangheeseok1 <yangheeseok@kei.re.kr>"
```

---

## Task 9: Migrate `src/kofin` to use common modules

**Files:**
- Modify: `src/kofin/api/client.ts` — replace local cache+breaker+retry with `createResilientFetcher` and `createTtlCache`; replace local NON_RETRYABLE_CODES set with `classifyResultCode`
- Delete: `src/kofin/api/cache.ts` (replaced by common)

The kofin client has three fetch methods (`fetchOpenFiscal`, `fetchDataGoKr`, `fetchNaboStats`). Refactor only the resilience/cache layer; keep the per-API URL construction and response parsing unchanged.

- [ ] **Step 1: Rewrite `src/kofin/api/client.ts`**

Replace the entire file contents with:

```typescript
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
```

- [ ] **Step 2: Delete the now-unused local cache module**

```bash
git rm src/kofin/api/cache.ts
```

- [ ] **Step 3: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Run all tests to confirm common modules still pass**

```bash
npm test
```

Expected: all tests pass (sanity + cache + result-code + resilient-fetch).

- [ ] **Step 5: Commit**

```bash
git add src/kofin/api/client.ts
git commit -m "Migrate src/kofin to common modules

Replace kofin's local TTL cache, p-retry, p-limit, and opossum
breaker stack with src/common/cache.ts and src/common/resilient-fetch.ts.
Replace local NON_RETRYABLE_CODES set with common classifyResultCode().

Behavior preserved: retries=2, concurrency=3, breaker errorThreshold=50%,
reset=30s. Per-API URL construction and response parsing unchanged.

Co-Authored-By: yangheeseok1 <yangheeseok@kei.re.kr>"
```

---

## Task 10: Migrate `src/lofin` to use common modules

**Files:**
- Modify: `src/lofin/client.ts` — replace local TtlCache, breaker, retry stack with common modules

The lofin client has one entry point (`fiscalQuery`) and one circuit breaker. Refactor the resilience/cache layer; keep the per-spec parameter validation and `parseResponse` unchanged.

- [ ] **Step 1: Rewrite `src/lofin/client.ts`**

Replace the entire file contents with:

```typescript
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
```

- [ ] **Step 2: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: exit 0. If `getCacheStats` callers expected the old success/failures fields, that's an incompatible change — consumers should switch to the new `getBreakerStats` return shape.

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Run full build to verify dist generation**

```bash
npm run build
```

Expected: exit 0; `dist/index.js`, `dist/kofin/`, `dist/lofin/`, `dist/common/` all created.

- [ ] **Step 5: Commit**

```bash
git add src/lofin/client.ts
git commit -m "Migrate src/lofin to common modules

Replace lofin's local TtlCache class, p-retry, p-limit, and opossum
breaker stack with src/common/cache.ts and src/common/resilient-fetch.ts.
classifyResultCode is now imported from common.

The breaker stats API simplified — getBreakerStats() now returns
{ state } only. getCacheStats() returns { size, max, ttlMs }.

Co-Authored-By: yangheeseok1 <yangheeseok@kei.re.kr>"
```

---

## Task 11: Update CLAUDE.md follow-up list

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Mark common-extraction as done**

In `CLAUDE.md`, find the "Known follow-ups" section and remove item 2 (the common-code extraction). Add a new "Done in v0.1.1" section noting what changed.

Replace this block:

```markdown
2. **Extract shared HTTP/error/cache logic to `src/common/`** (1–3 hours, careful work)
   Both subsystems independently implement: retry (p-retry), circuit breaker (opossum), concurrency limit (p-limit), in-memory cache, error normalization for 200-OK error responses, pagination. Identify truly common parts, extract, refactor both subsystems to use the common module. Use `superpowers:writing-plans` skill before touching code.
```

with:

```markdown
2. ~~**Extract shared HTTP/error/cache logic to `src/common/`**~~ — done in v0.1.1. See `src/common/{cache,resilient-fetch,result-code}.ts` and tests under `tests/common/`. Both subsystems now go through `createResilientFetcher` and `createTtlCache`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Mark common-code extraction as done in CLAUDE.md

Co-Authored-By: yangheeseok1 <yangheeseok@kei.re.kr>"
```

---

## Task 12: Final verification + push

**Files:**
- (no file changes — verification only)

- [ ] **Step 1: Full test run**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Full build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 3: Push all commits**

```bash
git push
```

Expected: pushes Tasks 1–11's commits to `origin/main`.

- [ ] **Step 4: Verify on GitHub**

```bash
gh api repos/jinny-han/mcp-korea-fiscal/commits --jq '.[0:5] | .[] | "\(.sha[0:7]) \(.commit.message | split("\n")[0])"'
```

Expected: top of the list shows the new commits in reverse chronological order, all merged into main.

---

## Self-Review Checklist

- ✅ Each task has explicit Files: list
- ✅ Each step shows the code/command/expected output
- ✅ TDD discipline: every common module has its tests written first
- ✅ Frequent commits: one per task end (12 commits total)
- ✅ No "TODO/TBD/implement later" placeholders
- ✅ Type names consistent across tasks (`TtlCache`, `ResilientFetcher`, `ResultCodeClassification`)
- ✅ Imports use `.js` extension to match the rest of the codebase (TypeScript ESM convention)

## Out of scope for this plan (future)

- API runtime testing against real 열린재정 / 지방재정365 endpoints
- npm publish
- Smithery / awesome-mcp-servers registration
- Pagination helper extraction (only marginal duplication; skip)
- API-key handling unification (subsystems differ enough — kofin uses structured config, lofin uses lazy env read; not worth merging)
