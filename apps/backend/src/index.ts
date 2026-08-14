import 'dotenv/config';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { buildContainer } from './container.js';

const env = loadEnv();
const container = buildContainer({ env });
const app = await buildApp({ env, container });

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

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
