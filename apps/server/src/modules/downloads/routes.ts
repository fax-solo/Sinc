import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { CanonicalTrack } from '@sinc/shared';
import { AppError } from '@sinc/shared';
import type { TokenService } from '../auth/tokens.js';
import { authGuard, type AuthenticatedRequest } from '../../plugins/guard.js';
import type { DownloadsService } from './service.js';

export function registerDownloadRoutes(
  app: FastifyInstance,
  downloads: DownloadsService,
  tokenService: TokenService
): void {
  const guard = authGuard(tokenService);

  app.post('/music/tracks/:id/download', { preHandler: guard }, async (request, reply) => {
    const body = (request.body ?? {}) as { track?: CanonicalTrack };
    if (!body.track) {
      throw new AppError('MISSING_TRACK', 'Track payload required', 400);
    }
    const userId = (request as AuthenticatedRequest).auth.userId;
    // `startDownload` resolves any direct URL from `track.id` (ytdlp ids);
    // passing the path `:id` here would treat a provider id as a URL.
    const job = await downloads.startDownload(userId, body.track);
    return reply.status(201).send(job);
  });

  app.get('/music/downloads', { preHandler: guard }, async (request) => {
    const userId = (request as AuthenticatedRequest).auth.userId;
    const query = request.query as Record<string, unknown>;
    const take = Number(query.limit ?? 200);
    return downloads.listByUser(userId, {
      take: Number.isFinite(take) ? take : undefined,
    });
  });

  app.get('/music/downloads/:jobId', { preHandler: guard }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const userId = (request as AuthenticatedRequest).auth.userId;
    const job = await downloads.getForUser(jobId, userId);
    if (!job) return reply.status(404).send({ error: 'Download not found' });
    return job;
  });

  app.delete('/music/downloads/:jobId', { preHandler: guard }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const userId = (request as AuthenticatedRequest).auth.userId;
    await downloads.remove(jobId, userId);
    return reply.status(204).send();
  });

  app.get('/music/downloads/:jobId/file', { preHandler: guard }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const userId = (request as AuthenticatedRequest).auth.userId;
    const filePath = await downloads.filePath(jobId, userId);
    if (!filePath) return reply.status(404).send({ error: 'Download not found' });
    try {
      await fs.access(filePath);
    } catch {
      return reply.status(404).send({ error: 'Download not found' });
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = ext === '.ogg' ? 'audio/ogg' : 'audio/mpeg';
    return reply.type(type).send(createReadStream(filePath));
  });
}
