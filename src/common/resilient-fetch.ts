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

  // The breaker wraps the full retry sequence. This way individual transient
  // failures don't trip the breaker — only exhausted retries count against it.
  // ctx carries the work function + retry options so the breaker stays generic.
  const breaker = new CircuitBreaker(
    async (ctx: {
      work: () => Promise<unknown>;
      retries: number;
      retryDelayMin: number;
      retryDelayMax: number;
    }) =>
      pRetry(() => ctx.work(), {
        retries: ctx.retries,
        minTimeout: ctx.retryDelayMin,
        maxTimeout: ctx.retryDelayMax,
        randomize: true,
      }),
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
        breaker.fire({
          work,
          retries,
          retryDelayMin,
          retryDelayMax,
        }) as Promise<T>,
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
