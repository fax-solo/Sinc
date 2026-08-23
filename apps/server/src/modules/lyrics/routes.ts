import type { FastifyInstance } from 'fastify';
import type { CanonicalTrack } from '@sinc/shared';
import { AppError } from '@sinc/shared';
import type { TokenService } from '../auth/tokens.js';
import { authGuard } from '../../plugins/guard.js';
import type { LyricsService } from '../../lib/lyrics.js';

export function registerLyricsRoutes(
  app: FastifyInstance,
  lyrics: LyricsService,
  tokenService: TokenService
): void {
  const guard = authGuard(tokenService);

  app.post('/music/tracks/:id/lyrics', { preHandler: guard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { track?: CanonicalTrack };
    if (!body.track) {
      throw new AppError('MISSING_TRACK', 'Track payload required', 400);
    }
    const result = await lyrics.getLyrics({ ...body.track, id });
    return reply.send(result);
  });
}
