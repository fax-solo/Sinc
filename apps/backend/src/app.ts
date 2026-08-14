import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { errorHandler } from './plugins/error-handler.js';
import { NotFoundError, errorBody } from '@sinc/shared';
import { registerHealthRoutes, loadEnv, type Env } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerUserRoutes } from './routes/users.js';
import { registerMusicRoutes } from './routes/music.js';
import { registerPlaybackRoutes } from './routes/playback.js';
import { registerSyncRoutes } from './routes/sync.js';
import type { Container } from './container.js';

export interface BuildAppOptions {
  env?: Env;
  loggerEnabled?: boolean;
  /** Required for auth/user routes; omitted in infra-only tests. */
  container?: Container;
}

export type TypedApp = FastifyInstance;

/**
 * Build a configured Fastify instance. Testable without binding a socket:
 * call app.inject() against the returned instance.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<TypedApp> {
  const env = options.env ?? loadEnv();

  const app = Fastify({
    logger: (options.loggerEnabled ?? env.NODE_ENV !== 'test') ? { level: env.LOG_LEVEL } : false,
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID(),
  });

  app.setErrorHandler(errorHandler);

  app.setNotFoundHandler((request, reply) => {
    const err = new NotFoundError(`Route ${request.method} ${request.url} not found`);
    reply.status(err.status).send(errorBody(err.code, err.message, request.id));
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await registerHealthRoutes(app, { env });

  const container = options.container;
  if (container) {
    await app.register(
      async (api) => {
        await registerAuthRoutes(api, { container });
        await registerUserRoutes(api, { container });
        await registerMusicRoutes(api, { container });
        await registerPlaybackRoutes(api, { container });
        await registerSyncRoutes(api, { container });
      },
      { prefix: '/api/v1' },
    );
  }

  return app;
}
