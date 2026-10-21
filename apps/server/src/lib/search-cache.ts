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

/**
 * How long a value stays physically readable on Redis after its TTL expires.
 * This bounds how long `getStale` can hand out an outdated mix/generated feed
 * while the fresh copy is being rebuilt (gradual mix refresh). After the grace
 * window Redis evicts the key entirely and stale reads turn into misses.
 */
const STALE_GRACE_SECONDS = 600;

interface CacheEnvelope<T> {
  value: T;
  expiresAt: number;
}

export function createSearchCache(redisUrl?: string): SearchCache {
  const env = getEnv();
  const resolved = redisUrl ?? env.REDIS_URL;

  if (resolved) {
    const redis = new Redis(resolved, {
      maxRetriesPerRequest: 3,
    });

    return {
      async get<T>(key: string) {
        try {
          const data = await redis.get(key);
          if (!data) return null;
          const envelope = JSON.parse(data) as CacheEnvelope<T>;
          return Date.now() > envelope.expiresAt ? null : envelope.value;
        } catch {
          return null;
        }
      },
      async getStale<T>(key: string) {
        try {
          const data = await redis.get(key);
          if (!data) return null;
          const envelope = JSON.parse(data) as CacheEnvelope<T>;
          return envelope.value;
        } catch {
          return null;
        }
      },
      async set(key: string, value: unknown, ttlSeconds: number) {
        try {
          const envelope: CacheEnvelope<unknown> = {
            value,
            expiresAt: Date.now() + ttlSeconds * 1000,
          };
          // Physical TTL = value TTL + a bounded stale grace window so expired
          // entries stay readable via getStale until the grace window closes.
          await redis.setex(key, ttlSeconds + STALE_GRACE_SECONDS, JSON.stringify(envelope));
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
