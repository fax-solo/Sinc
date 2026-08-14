import { z } from 'zod';
import { success } from '@sinc/shared';
import type { TypedApp } from '../app.js';
import type { Container } from '../container.js';
import { authGuard } from '../plugins/guard.js';
import { rateLimitHook } from '../plugins/rate-limit.js';

const PlaylistUpsert = z.object({
  kind: z.literal('playlistUpsert'),
  opId: z.string().trim().min(1).max(200),
  playlistId: z.string().trim().min(1).max(200),
  baseVersion: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(300),
  description: z.string().max(2_000).nullable().optional(),
  isCollaborative: z.boolean().optional(),
  trackIds: z.array(z.string().trim().min(1).max(200)).max(5_000),
  createdAt: z.number().int().nonnegative(),
});

const PlaylistDelete = z.object({
  kind: z.literal('playlistDelete'),
  opId: z.string().trim().min(1).max(200),
  playlistId: z.string().trim().min(1).max(200),
  baseVersion: z.number().int().nonnegative(),
});

const FavoriteToggle = z.object({
  kind: z.literal('favoriteToggle'),
  opId: z.string().trim().min(1).max(200),
  targetType: z.enum(['track', 'artist', 'album']),
  targetId: z.string().trim().min(1).max(200),
  title: z.string().max(500).nullable().optional(),
  subtitle: z.string().max(500).nullable().optional(),
  addedAt: z.number().int().nonnegative(),
});

const ApplyBody = z.object({
  mutations: z
    .array(z.discriminatedUnion('kind', [PlaylistUpsert, PlaylistDelete, FavoriteToggle]))
    .max(500),
});

export async function registerSyncRoutes(
  app: TypedApp,
  opts: { container: Container },
): Promise<void> {
  const { container } = opts;
  const guard = authGuard(container.tokenService);

  app.get('/sync/snapshot', {
    onRequest: [guard, rateLimitHook(container.rateLimiter, 'sync')],
    handler: async (request, reply) => {
      const snapshot = await container.sync.snapshot(request.auth!.userId);
      return reply.send(success(snapshot, request.id));
    },
  });

  app.post('/sync/apply', {
    onRequest: [guard, rateLimitHook(container.rateLimiter, 'sync')],
    handler: async (request, reply) => {
      const body = ApplyBody.parse(request.body);
      const result = await container.sync.apply(request.auth!.userId, body.mutations);
      return reply.send(success(result, request.id));
    },
  });
}
