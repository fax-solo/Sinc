import type { FastifyRequest, FastifyReply } from 'fastify';
import { RateLimitError } from '@sinc/shared';
import type { RateLimiter } from '../domain/auth/types.js';

/**
 * preHandler hook factory: consume one unit for the scope, keyed by the
 * X-Device-Id header when present, else the client IP.
 */
export function rateLimitHook(limiter: RateLimiter, scope: string) {
  return async function hook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const identifier =
      (request.headers['x-device-id'] as string | undefined) ?? request.ip ?? 'unknown';
    const { allowed, retryAfterSeconds } = await limiter.consume(scope, identifier);
    if (!allowed) {
      reply.header('retry-after', String(retryAfterSeconds));
      throw new RateLimitError('Too many requests, try again later', {
        scope,
        retryAfterSeconds,
      });
    }
  };
}
