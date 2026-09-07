import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ValidationError } from '@sinc/shared';
import { adminGuard, type AuthenticatedRequest } from '../../plugins/guard.js';
import type { TokenService } from '../auth/tokens.js';
import type { AdminService } from './service.js';

const DESTRUCTIVE_ACTIONS = new Set([
  'promote',
  'demote',
  'suspend',
  'unsuspend',
  'delete',
  'reset-password',
]);

function intParam(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export function registerAdminRoutes(
  app: FastifyInstance,
  admin: AdminService,
  tokenService: TokenService
): void {
  const guard = adminGuard(tokenService);

  // ---- User / list management --------------------------------------------

  app.get('/admin/stats/overview', { preHandler: guard }, async () => {
    return admin.statsOverview();
  });

  app.get('/admin/stats/activity', { preHandler: guard }, async (request) => {
    const { days } = request.query as { days?: unknown };
    return admin.statsActivity(intParam(days, 14, 90));
  });

  app.get('/admin/stats/top', { preHandler: guard }, async (request) => {
    const { limit } = request.query as { limit?: unknown };
    return admin.statsTop(intParam(limit, 10, 25));
  });

  app.get('/admin/users', { preHandler: guard }, async (request) => {
    const { page, limit, query, role, status, sort } = request.query as {
      page?: unknown;
      limit?: unknown;
      query?: unknown;
      role?: unknown;
      status?: unknown;
      sort?: unknown;
    };
    const q = typeof query === 'string' ? query.trim().slice(0, 80) : undefined;
    const r = role === 'admin' || role === 'user' ? role : undefined;
    const s = status === 'active' || status === 'suspended' ? status : undefined;
    const so = sort === 'createdAt' || sort === 'lastLoginAt' ? sort : 'createdAt';
    return admin.listUsers(intParam(page, 1, 10_000), intParam(limit, 20, 100), {
      query: q,
      role: r,
      status: s,
      sort: so,
    });
  });

  app.get('/admin/users/:id', { preHandler: guard }, async (request) => {
    const { id } = request.params as { id: string };
    return admin.getUser(id);
  });

  app.get('/admin/users/:id/detail', { preHandler: guard }, async (request) => {
    const { id } = request.params as { id: string };
    return admin.userDetail(id);
  });

  app.patch('/admin/users/:id', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { action?: unknown };
    const action = String(body.action ?? '');
    if (!DESTRUCTIVE_ACTIONS.has(action)) {
      throw new ValidationError(
        'action must be one of: promote, demote, suspend, unsuspend, delete, reset-password'
      );
    }

    switch (action) {
      case 'promote':
        await admin.promote(auth.userId, id);
        break;
      case 'demote':
        await admin.demote(auth.userId, id);
        break;
      case 'suspend':
        await admin.suspend(auth.userId, id);
        break;
      case 'unsuspend':
        await admin.unsuspend(auth.userId, id);
        break;
      case 'delete':
        await admin.deleteUser(auth.userId, id);
        break;
      case 'reset-password':
        return admin.forceReset(auth.userId, id);
    }
    return { ok: true };
  });

  app.delete('/admin/users/:id', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    await admin.deleteUser(auth.userId, id);
    return { ok: true };
  });

  app.post('/admin/users/:id/reset-password', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    return admin.forceReset(auth.userId, id);
  });

  app.get('/admin/users/:id/sessions', { preHandler: guard }, async (request) => {
    const { id } = request.params as { id: string };
    return admin.listSessions(id);
  });

  app.delete('/admin/sessions/:id', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    await admin.revokeSession(auth.userId, id);
    return { ok: true };
  });

  // ---- Playlists ---------------------------------------------------------

  app.get('/admin/playlists', { preHandler: guard }, async (request) => {
    const { page, limit, query } = request.query as {
      page?: unknown;
      limit?: unknown;
      query?: unknown;
    };
    const q = typeof query === 'string' ? query.trim().slice(0, 80) : undefined;
    return admin.listPlaylists(intParam(page, 1, 10_000), intParam(limit, 20, 100), q || undefined);
  });

  app.delete('/admin/playlists/:id', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    await admin.deletePlaylist(auth.userId, id);
    return { ok: true };
  });

  // ---- Downloads monitoring ----------------------------------------------

  app.get('/admin/downloads', { preHandler: guard }, async (request) => {
    const { page, limit, status, query, userId } = request.query as {
      page?: unknown;
      limit?: unknown;
      status?: unknown;
      query?: unknown;
      userId?: unknown;
    };
    const sq = typeof status === 'string' ? status.slice(0, 20) : undefined;
    const q = typeof query === 'string' ? query.trim().slice(0, 80) : undefined;
    const uid = typeof userId === 'string' && userId.length > 0 ? userId.slice(0, 100) : undefined;
    return admin.listDownloads(intParam(page, 1, 10_000), intParam(limit, 30, 200), {
      status: sq,
      query: q,
      userId: uid,
    });
  });

  app.get('/admin/downloads/stats', { preHandler: guard }, async () => {
    return admin.downloadStats();
  });

  app.post('/admin/downloads/:id/retry', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    return admin.retryDownload(auth.userId, id);
  });

  app.post('/admin/downloads/:id/cancel', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    return admin.cancelDownload(auth.userId, id);
  });

  // ---- Devices -----------------------------------------------------------

  app.get('/admin/devices', { preHandler: guard }, async (request) => {
    const { userId } = request.query as { userId?: unknown };
    const uid = typeof userId === 'string' && userId.length > 0 ? userId.slice(0, 100) : undefined;
    return admin.listDevices(uid);
  });

  app.delete('/admin/devices/:id', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    await admin.revokeDevice(auth.userId, id);
    return { ok: true };
  });

  // ---- Audit -------------------------------------------------------------

  app.get('/admin/audit', { preHandler: guard }, async (request) => {
    const { page, limit, action } = request.query as {
      page?: unknown;
      limit?: unknown;
      action?: unknown;
    };
    const a = typeof action === 'string' && action.length > 0 ? action.slice(0, 60) : undefined;
    return admin.listAudit(intParam(page, 1, 10_000), intParam(limit, 30, 100), a);
  });

  // ---- System / reliability ----------------------------------------------

  app.get('/admin/system', { preHandler: guard }, async () => {
    return admin.systemHealth();
  });

  app.get('/admin/caches', { preHandler: guard }, async () => {
    return admin.cacheSizes();
  });

  app.get('/admin/reliability', { preHandler: guard }, async (request) => {
    const { days } = request.query as { days?: unknown };
    return admin.reliabilityOverview(intParam(days, 30, 90));
  });
}
