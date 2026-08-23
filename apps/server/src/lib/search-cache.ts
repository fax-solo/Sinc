import { Redis } from 'ioredis';
import { getEnv } from '../config/env.js';

export interface SearchCache {
  get<T>(key: string): Promise<T | null>;
  /** Reads an entry even if it has expired (used for gradual mix refresh). */
  getStale<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

function searchKey(...parts: string[]): string {
  return `search:${parts.join(':')}`;
}

export { searchKey };

export function createSearchCache(): SearchCache {
  const env = getEnv();

  if (env.REDIS_URL) {
    const redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
    });

    return {
      async get<T>(key: string) {
        try {
          const data = await redis.get(key);
          return data ? (JSON.parse(data) as T) : null;
        } catch {
          return null;
        }
      },
      async getStale<T>(key: string) {
        // Redis evicts expired keys on its own; an expired entry is simply gone.
        return this.get<T>(key);
      },
      async set(key: string, value: unknown, ttlSeconds: number) {
        try {
          await redis.setex(key, ttlSeconds, JSON.stringify(value));
        } catch {
          // Ignore cache errors
        }
      },
      async delete(key: string) {
        try {
          await redis.del(key);
        } catch {
          // Ignore
        }
      },
    };
  }

  // In-memory fallback. LRU-evicted: entries are re-inserted on every hit so
  // the Map's insertion order doubles as recency, and the oldest entries are
  // evicted first once the cap is exceeded.
  const memory = new Map<string, { value: unknown; expiresAt: number }>();
  const MEMORY_CAP = 2000;

  const touch = (key: string) => {
    const entry = memory.get(key);
    if (!entry) return;
    memory.delete(key);
    memory.set(key, entry);
  };

  return {
    async get<T>(key: string) {
      const entry = memory.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) return null;
      touch(key);
      return entry.value as T;
    },
    async getStale<T>(key: string) {
      const entry = memory.get(key);
      if (!entry) return null;
      touch(key);
      return entry.value as T;
    },
    async set(key: string, value: unknown, ttlSeconds: number) {
      if (memory.has(key)) memory.delete(key);
      memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      if (memory.size > MEMORY_CAP) {
        const oldest = memory.keys().next().value;
        if (oldest !== undefined) memory.delete(oldest);
      }
    },
    async delete(key: string) {
      memory.delete(key);
    },
  };
}
