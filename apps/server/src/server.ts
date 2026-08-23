import { loadEnv } from './config/env.js';
import { buildApp } from './app.js';
import { prisma } from './lib/prisma.js';
import { initObservability } from './lib/observability.js';
import { startRetentionSweeper } from './lib/retention.js';

async function main() {
  const env = loadEnv();
  await initObservability(env);
  const app = await buildApp(env);

  await app.listen({ host: env.HOST, port: env.PORT });

  const stopRetention = startRetentionSweeper();

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down...`);
    stopRetention();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
