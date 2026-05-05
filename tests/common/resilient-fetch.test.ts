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
