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
