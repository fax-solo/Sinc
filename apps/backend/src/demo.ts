import 'dotenv/config';
import { buildApp } from './app.js';
import { buildContainer } from './container.js';
import { loadEnv } from './config/env.js';
import {
  MemoryUserRepository,
  MemorySessionRepository,
  MemoryDeviceRepository,
  MemoryVerificationTokenRepository,
  MemoryNotificationRepository,
} from './persistence/memory-repos.js';

/**
 * Demo server: boots the full API with in-memory repositories, no Postgres,
 * no Redis (rate limiter / search cache fall back to memory). JWT keys are
 * auto-generated. All data resets when the process restarts.
 *
 *   npm run demo -w @sinc/backend
 *
 * Verification codes are printed to the console ([mail:verify] url=...).
 */
const env = loadEnv();

const container = buildContainer({
  env,
  redis: null,
  db: null,
  repositories: {
    user: new MemoryUserRepository(),
    session: new MemorySessionRepository(),
    device: new MemoryDeviceRepository(),
    verificationToken: new MemoryVerificationTokenRepository(),
    notification: new MemoryNotificationRepository(),
  },
});

const app = await buildApp({ env, container });

app.addHook('onRequest', async (request) => {
  app.log.info(`${request.method} ${request.url}`);
});

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

const base = `http://${env.HOST === '0.0.0.0' ? 'localhost' : env.HOST}:${env.PORT}`;
app.log.info(
  {
    base,
    mode: 'memory (no Postgres/Redis; data resets on restart)',
  },
  `Sinc demo server running — try:
    POST ${base}/api/v1/auth/register        { "email": "you@example.com", "password": "password123", "username": "you" }
    GET  ${base}/api/v1/auth/verify-email?token=<code>   (code printed above as [mail:verify])
    POST ${base}/api/v1/auth/login           { "email": "you@example.com", "password": "password123" }
    GET  ${base}/api/v1/music/search?q=beyonce   (Authorization: Bearer <accessToken>)`,
);

const shutdown = (signal: string) => {
  app.log.info({ signal }, 'Shutting down');
  void container
    .close?.()
    .catch(() => undefined)
    .finally(() => app.close())
    .finally(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
