import { z } from 'zod';
import { success } from '@sinc/shared';
import { loadEnv, type Env } from '../config/env.js';
import type { TypedApp } from '../app.js';

const HealthQuery = z.object({
  detail: z.coerce.boolean().optional(),
});

type HealthQueryInput = z.infer<typeof HealthQuery>;

export async function healthRoutes(app: TypedApp, opts: { env: Env }): Promise<void> {
  const { env } = opts;

  app.get<{ Querystring: HealthQueryInput }>('/health', {
    handler: async (request, reply) => {
      const query = HealthQuery.parse(request.query);
      const detail = query.detail ?? false;
      const payload = detail
        ? {
            status: 'ok' as const,
            uptimeSec: Math.round(process.uptime()),
            version: '0.1.0',
            environment: env.NODE_ENV,
            memory: process.memoryUsage().rss,
          }
        : { status: 'ok' as const };
      return reply.send(success(payload, request.id));
    },
  });
}

export async function registerHealthRoutes(app: TypedApp, options: { env: Env }): Promise<void> {
  await healthRoutes(app, options);
}

export { loadEnv };
export type { Env };
