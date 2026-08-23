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
  const clientIp = (request: FastifyRequest): string | undefined =>
    (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    (request.headers['x-real-ip'] as string | undefined);

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
    const { page, limit, query } = request.query as {
      page?: unknown;
      limit?: unknown;
      query?: unknown;
    };
    const q = typeof query === 'string' ? query.trim().slice(0, 80) : undefined;
    return admin.listUsers(intParam(page, 1, 10_000), intParam(limit, 20, 100), q || undefined);
  });

  app.get('/admin/users/:id', { preHandler: guard }, async (request) => {
    const { id } = request.params as { id: string };
    return admin.getUser(id);
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
    const otp = request.headers['x-admin-otp'] as string | undefined;
    await admin.assertMfa(auth.userId, otp);
    const ip = clientIp(request);

    switch (action) {
      case 'promote':
        await admin.promote(auth.userId, id, ip);
        break;
      case 'demote':
        await admin.demote(auth.userId, id, ip);
        break;
      case 'suspend':
        await admin.suspend(auth.userId, id, ip);
        break;
      case 'unsuspend':
        await admin.unsuspend(auth.userId, id, ip);
        break;
      case 'delete':
        await admin.deleteUser(auth.userId, id, ip);
        break;
      case 'reset-password':
        return admin.forceReset(auth.userId, id, ip);
    }
    return { ok: true };
  });

  app.delete('/admin/users/:id', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    const otp = request.headers['x-admin-otp'] as string | undefined;
    await admin.assertMfa(auth.userId, otp);
    await admin.deleteUser(auth.userId, id, clientIp(request));
    return { ok: true };
  });

  app.post('/admin/users/:id/reset-password', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    const otp = request.headers['x-admin-otp'] as string | undefined;
    await admin.assertMfa(auth.userId, otp);
    return admin.forceReset(auth.userId, id, clientIp(request));
  });

  app.get('/admin/users/:id/sessions', { preHandler: guard }, async (request) => {
    const { id } = request.params as { id: string };
    return admin.listSessions(id);
  });

  app.delete('/admin/sessions/:id', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const { id } = request.params as { id: string };
    const otp = request.headers['x-admin-otp'] as string | undefined;
    await admin.assertMfa(auth.userId, otp);
    await admin.revokeSession(auth.userId, id, clientIp(request));
    return { ok: true };
  });

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
    const otp = request.headers['x-admin-otp'] as string | undefined;
    await admin.assertMfa(auth.userId, otp);
    await admin.deletePlaylist(auth.userId, id, clientIp(request));
    return { ok: true };
  });

  app.get('/admin/audit', { preHandler: guard }, async (request) => {
    const { page, limit, action } = request.query as {
      page?: unknown;
      limit?: unknown;
      action?: unknown;
    };
    const a = typeof action === 'string' && action.length > 0 ? action.slice(0, 60) : undefined;
    return admin.listAudit(intParam(page, 1, 10_000), intParam(limit, 30, 100), a);
  });

  // ---- MFA (self-service for the signed-in admin) -----------------------

  app.get('/admin/mfa', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    return admin.mfaStatus(auth.userId);
  });

  app.post('/admin/mfa/enroll', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    return admin.mfaEnroll(auth.userId);
  });

  app.post('/admin/mfa/verify', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const body = (request.body ?? {}) as { code?: unknown };
    const code = String(body.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) throw new ValidationError('A 6-digit code is required');
    await admin.mfaVerify(auth.userId, code, clientIp(request));
    return { ok: true };
  });

  app.post('/admin/mfa/disable', { preHandler: guard }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const body = (request.body ?? {}) as { code?: unknown };
    const code = String(body.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) throw new ValidationError('A 6-digit code is required');
    await admin.mfaDisable(auth.userId, code, clientIp(request));
    return { ok: true };
  });
}
