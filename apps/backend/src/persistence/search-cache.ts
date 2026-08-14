import type { Redis } from 'ioredis';

export interface SearchCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  /** Test hook: drop all cached entries (in-memory impl only). */
  resetForTest?(): void;
}

export function searchKey(
  kind: 'search' | 'suggest' | 'detail' | 'sources',
  query: string,
  filterKey = '',
): string {
  const q = query.trim().toLowerCase();
  return `music:${kind}:${filterKey ? `${filterKey}:` : ''}${q}`;
}

/**
 * Fixed-TTL JSON cache. Uses Redis when available (SETEX/GET with JSON
 * serialization); falls back to an in-memory Map with expiry so the server
 * still works without Redis. Never throws - a cache failure must not fail
 * a search, callers treat misses as cache errors.
 */
export class SearchCacheService implements SearchCache {
  private readonly memory = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    private readonly redis: Redis | null,
    private readonly now: () => number = Date.now,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.redis) {
        const raw = await this.redis.get(key);
        return raw == null ? null : (JSON.parse(raw) as T);
      }
      const entry = this.memory.get(key);
      if (!entry) return null;
      if (this.now() > entry.expiresAt) {
        this.memory.delete(key);
        return null;
      }
      return JSON.parse(entry.value) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      const raw = JSON.stringify(value);
      if (this.redis) {
        await this.redis.set(key, raw, 'EX', ttlSeconds);
        return;
      }
      this.memory.set(key, { value: raw, expiresAt: this.now() + ttlSeconds * 1000 });
    } catch {
      // cache write failures are non-fatal
    }
  }

  resetForTest(): void {
    this.memory.clear();
  }
}

/**
 * Single-flight wrapper: identical in-flight requests share one underlying
 * promise (debounces repeated identical searches within a window) instead of
 * hammering providers in parallel.
 */
export class SingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const promise = fn().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  size(): number {
    return this.inFlight.size;
  }
}
