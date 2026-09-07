import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import type { Env } from './config/env.js';
import { loadEnv } from './config/env.js';
import { errorHandler } from './plugins/error-handler.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { TokenService } from './modules/auth/tokens.js';
import { AuthService } from './modules/auth/service.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { ItunesAdapter } from './lib/itunes.js';
import { DeezerAdapter } from './lib/deezer.js';
import { YtdlpResolver } from './lib/ytdlp.js';
import { DownloadResolver } from './lib/download-source.js';
import { createSearchCache } from './lib/search-cache.js';
import { buildMusicRoutes } from './modules/music/routes.js';
import { PersonalizationService } from './modules/music/personalization.js';
import { MusicSignalService } from './modules/music/signals.js';
import { DownloadsService } from './modules/downloads/service.js';
import { registerDownloadRoutes } from './modules/downloads/routes.js';
import { LyricsService, LrclibProvider } from './lib/lyrics.js';
import { YoutubeCaptionsProvider } from './lib/youtube-captions.js';
import { registerLyricsRoutes } from './modules/lyrics/routes.js';
import { AdminService } from './modules/admin/service.js';
import { registerAdminRoutes } from './modules/admin/routes.js';
import { AnalyticsService } from './modules/analytics/service.js';
import { registerAnalyticsRoutes } from './modules/analytics/routes.js';
import { inc } from './lib/metrics.js';
import { prisma } from './lib/prisma.js';

/**
 * One-time admin bootstrap: when ADMIN_BOOTSTRAP_EMAIL is configured, the
 * matching account is promoted to admin on startup. Idempotent and safe to
 * leave set (re-promotion is a no-op for the same account).
 */
export async function bootstrapAdmin(env: Env): Promise<void> {
  if (!env.ADMIN_BOOTSTRAP_EMAIL) return;
  await prisma.user.updateMany({
    where: { email: env.ADMIN_BOOTSTRAP_EMAIL },
    data: { role: 'admin' },
  });
}

export async function buildApp(
  env: Env = loadEnv(),
  deps: { downloads?: DownloadsService; lyrics?: LyricsService } = {}
) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'req.headers["x-auth-token"]',
          'req.body.password',
          'req.body.oldPassword',
          'req.body.newPassword',
          'req.body.currentPassword',
          'req.body.refreshToken',
          'req.body.accessToken',
          'req.body.token',
        ],
        censor: '[REDACTED]',
      },
      transport:
        env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
          : undefined,
    },
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  app.setErrorHandler(errorHandler);

  // Coarse request/error counters for the Prometheus /metrics endpoint.
  app.addHook('onResponse', async (request, _reply) => {
    if (env.METRICS_ENABLED) {
      inc('sinc_http_requests_total', {
        method: request.method,
        route: request.routeOptions.url ?? 'unknown',
      });
    }
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    credentials: true,
  });

  // gzip/brotli for large JSON payloads (home feed, search, album/artist pages).
  await app.register(compress, { threshold: 1024 });

  // Global per-IP rate limit (M9.2). Auth endpoints get a stricter cap via
  // per-route config in the auth module. Exceedances are logged for abuse
  // monitoring but never reveal the client's identity.
  if (env.RATE_LIMIT_ENABLED) {
    await app.register(rateLimit, {
      global: true,
      max: env.RATE_LIMIT_MAX,
      timeWindow: '1 minute',
      keyGenerator: (request) => request.ip,
      onExceeded: (request) =>
        request.log.warn({ route: request.routeOptions.url }, 'rate limit exceeded'),
      errorResponseBuilder: () => ({
        status: 429,
        code: 'RATE_LIMITED',
        message: 'Too many requests, slow down',
      }),
    });
  }

  registerHealthRoutes(app, env);

  const tokenService = new TokenService();
  const authService = new AuthService(tokenService);
  registerAuthRoutes(app, authService, tokenService);

  const itunes = new ItunesAdapter();
  const deezer = new DeezerAdapter();
  const ytdlp = new YtdlpResolver();
  const cache = createSearchCache();
  const personalization = new PersonalizationService();
  const signals = new MusicSignalService();
  buildMusicRoutes(app, itunes, deezer, ytdlp, cache, personalization, signals, tokenService);

  const lyrics =
    deps.lyrics ?? new LyricsService([new LrclibProvider(), new YoutubeCaptionsProvider(ytdlp)]);
  const downloads = deps.downloads ?? new DownloadsService(new DownloadResolver(ytdlp), lyrics);
  registerDownloadRoutes(app, downloads, tokenService);

  registerLyricsRoutes(app, lyrics, tokenService);

  const adminService = new AdminService(downloads);
  registerAdminRoutes(app, adminService, tokenService);

  const analytics = new AnalyticsService();
  registerAnalyticsRoutes(app, analytics, tokenService);

  await bootstrapAdmin(env);

  return app;
}
