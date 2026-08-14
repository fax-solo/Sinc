import { z } from 'zod';
import { ForbiddenError, success } from '@sinc/shared';
import type { TypedApp } from '../app.js';
import type { Container } from '../container.js';
import { authGuard } from '../plugins/guard.js';
import { rateLimitHook } from '../plugins/rate-limit.js';
import { searchKey, type SearchCache } from '../persistence/search-cache.js';

const RESOLVE_TTL_SECONDS = 120;

const TrackParams = z.object({
  id: z.string().trim().min(1).max(200),
});

const ResolveQuery = z.object({
  provider: z.string().trim().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const StreamQuery = z.object({
  url: z.string().trim().min(1).max(2_048),
  exp: z.coerce.number().int().positive(),
  sig: z.string().trim().min(1).max(128),
});

export async function registerPlaybackRoutes(
  app: TypedApp,
  opts: { container: Container },
): Promise<void> {
  const { container } = opts;
  const guard = authGuard(container.tokenService);
  const cache: SearchCache = container.searchCache;

  app.get('/playback/tracks/:id/resolve', {
    onRequest: [guard, rateLimitHook(container.rateLimiter, 'search')],
    handler: async (request, reply) => {
      const { id } = TrackParams.parse(request.params);
      const query = ResolveQuery.parse(request.query);
      const key = searchKey('sources', `playback:${id}`, `p=${query.provider ?? 'any'}`);
      const cached = await cache.get<unknown>(key);
      if (cached) return reply.send(success(cached, request.id));

      const payload = await container.singleFlight.run(key, () =>
        container.playback.resolveTrack(id, {
          provider: query.provider,
          limit: query.limit,
          offset: query.offset,
        }),
      );
      await cache.set(key, payload, RESOLVE_TTL_SECONDS);
      return reply.send(success(payload, request.id));
    },
  });

  app.get('/playback/stream', {
    onRequest: [rateLimitHook(container.rateLimiter, 'stream')],
    handler: async (request, reply) => {
      const query = StreamQuery.parse(request.query);
      const valid = container.streamSigner.verify(query.url, query.exp, query.sig);
      if (!valid) {
        throw new ForbiddenError('Invalid or expired stream signature');
      }
      return reply.redirect(query.url);
    },
  });
}
