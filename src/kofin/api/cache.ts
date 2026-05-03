// src/api/cache.ts

interface CacheEntry<T> {
  readonly data: T;
  readonly expiresAt: number;
}

export interface Cache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, data: T, ttlSeconds: number): void;
  invalidate(key: string): void;
  clear(): void;
}

export function createCache(config: { enabled: boolean }): Cache {
  const store = new Map<string, CacheEntry<unknown>>();

  return {
    get<T>(key: string): T | undefined {
      if (!config.enabled) return undefined;
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return undefined;
      }
      return entry.data as T;
    },

    set<T>(key: string, data: T, ttlSeconds: number): void {
      if (!config.enabled) return;
      store.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
    },

    invalidate(key: string): void {
      store.delete(key);
    },

    clear(): void {
      store.clear();
    },
  };
}

export function buildCacheKey(parts: (string | number | undefined)[]): string {
  return parts.filter((p): p is string | number => p !== undefined).join(":");
}
