import type { FastifyInstance } from 'fastify';
import { ValidationError } from '@sinc/shared';
import { authGuard, type AuthenticatedRequest } from '../../plugins/guard.js';
import type { TokenService } from '../auth/tokens.js';
import { ANALYTICS_EVENTS, type AnalyticsEventName, type AnalyticsService } from './service.js';

export function registerAnalyticsRoutes(
  app: FastifyInstance,
  analytics: AnalyticsService,
  tokenService: TokenService
): void {
  const guard = authGuard(tokenService);

  app.post('/analytics/events', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const body = (request.body ?? {}) as { events?: unknown };
    if (!Array.isArray(body.events) || body.events.length === 0 || body.events.length > 200) {
      throw new ValidationError('events must be a non-empty array of at most 200 items');
    }
    const normalized = body.events.map((raw) => {
      const item = (raw ?? {}) as { event?: unknown; entityId?: unknown; meta?: unknown };
      const event = String(item.event ?? '');
      if (!(ANALYTICS_EVENTS as readonly string[]).includes(event)) {
        throw new ValidationError(`unknown event "${event}"`);
      }
      const meta =
        typeof item.meta === 'object' && item.meta !== null
          ? (item.meta as Record<string, string | number | boolean>)
          : undefined;
      return {
        event: event as AnalyticsEventName,
        entityId: typeof item.entityId === 'string' ? item.entityId.slice(0, 200) : undefined,
        meta,
      };
    });
    return analytics.record(auth.userId, normalized);
  });

  app.get('/analytics/preferences', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    return analytics.getPreference(auth.userId);
  });

  app.put('/analytics/preferences', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const body = (request.body ?? {}) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      throw new ValidationError('enabled must be a boolean');
    }
    return analytics.setPreference(auth.userId, body.enabled);
  });
}
