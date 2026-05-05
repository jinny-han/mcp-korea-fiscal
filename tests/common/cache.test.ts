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
