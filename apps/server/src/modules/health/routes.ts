import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { renderMetrics } from '../../lib/metrics.js';
import type { Env } from '../../config/env.js';

/**
 * Health module — proves the app, plugins, and database are wired together.
 * Also exposes Prometheus metrics (/metrics, when METRICS_ENABLED=true) and the
 * app version contract for the mobile forced-update path.
 */
export function registerHealthRoutes(app: FastifyInstance, env: Env): void {
  app.get('/health', async (request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', uptime: process.uptime() };
    } catch {
      request.log.error('Database health check failed');
      return reply.status(503).send({ status: 'error' });
    }
  });

  app.get('/', async () => ({
    name: 'Sinc API',
    version: '0.1.0',
    environment: process.env.NODE_ENV ?? 'development',
    time: new Date().toISOString(),
  }));

  app.get('/app/version', async () => {
    return {
      name: 'Sinc API',
      version: '0.1.0',
      minAppVersion: env.MIN_APP_VERSION,
      time: new Date().toISOString(),
    };
  });

  app.get('/metrics', async (request, reply) => {
    if (!env.METRICS_ENABLED) {
      return reply.status(404).send({ status: 404, code: 'NOT_FOUND', message: 'Not found' });
    }
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(renderMetrics());
  });
}
