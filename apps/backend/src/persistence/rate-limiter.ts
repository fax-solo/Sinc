import type { Redis } from 'ioredis';
import type { RateLimiter } from '../domain/auth/types.js';

export interface RateLimiterConfig {
  /** Bucket window in seconds (fixed window). */
  windowSeconds: number;
  /** Max requests per identifier per window. */
  maxRequests: number;
}

/**
 * Fixed-window rate limiter. Redis-backed in production (INCR + EXPIRE),
 * in-memory sliding-ish window for tests/dev without Redis. Per-scope limits
 * can override the default config (e.g. search is allowed more than auth).
 */
export class RateLimiterService implements RateLimiter {
  constructor(
    private readonly config: RateLimiterConfig,
    private readonly redis: Redis | null,
    private readonly scopeConfigs: Record<string, RateLimiterConfig> = {},
  ) {}

  private configFor(scope: string): RateLimiterConfig {
    return this.scopeConfigs[scope] ?? this.config;
  }

  async consume(
    scope: string,
    identifier: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    if (this.redis) {
      return this.consumeRedis(scope, identifier);
    }
    return this.consumeMemory(scope, identifier);
  }

  private async consumeRedis(
    scope: string,
    identifier: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const redis = this.redis!;
    const key = `rl:${scope}:${identifier}`;
    const { windowSeconds, maxRequests } = this.configFor(scope);
    const result = await redis.multi().incr(key).expire(key, windowSeconds, 'NX').exec();
    const count = Number(result?.[0]?.[1] ?? 0);
    const allowed = count <= maxRequests;
    const retryAfterSeconds = allowed
      ? 0
      : Math.max(1, windowSeconds - (Date.now() % (windowSeconds * 1000)) / 1000);
    return { allowed, retryAfterSeconds: Math.ceil(retryAfterSeconds) };
  }

  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  private consumeMemory(
    scope: string,
    identifier: string,
  ): { allowed: boolean; retryAfterSeconds: number } {
    const key = `${scope}:${identifier}`;
    const { windowSeconds, maxRequests } = this.configFor(scope);
    const windowMs = windowSeconds * 1000;
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    bucket.count += 1;
    if (bucket.count <= maxRequests) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  /** Test hook: reset all in-memory buckets. */
  resetForTest(): void {
    this.buckets.clear();
  }
}
