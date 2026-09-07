import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, bootstrapAdmin } from '../../app.js';
import { loadEnv } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';

const app = await buildApp();
const suffix = randomUUID().slice(0, 8);
const adminEmail = `admin-${suffix}@sinc.dev`;
const userEmail = `user-${suffix}@sinc.dev`;
const password = 'correct-horse-battery';

const registerBody = (email: string, username: string) => ({
  email,
  username,
  password,
  displayName: 'Test User',
});

async function registerUser(email: string, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: registerBody(email, username),
  });
  expect(res.statusCode).toBe(201);
  return res.json().tokens.accessToken as string;
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

let adminToken = '';
let userToken = '';
let userId = '';
let deviceId = '';

afterAll(async () => {
  await prisma.user
    .deleteMany({ where: { email: { in: [adminEmail, userEmail] } } })
    .catch(() => undefined);
  await app.close();
});

describe('admin module', () => {
  it('bootstraps the configured account to admin', async () => {
    await registerUser(adminEmail, `admin_${suffix}`);
    await registerUser(userEmail, `user_${suffix}`);
    await bootstrapAdmin({ ...loadEnv(), ADMIN_BOOTSTRAP_EMAIL: adminEmail });

    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    expect(admin?.role).toBe('admin');

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: adminEmail, password },
    });
    adminToken = login.json().tokens.accessToken as string;
    const userLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: userEmail, password },
    });
    userToken = userLogin.json().tokens.accessToken as string;
    expect(adminToken).toBeTruthy();
    expect(userToken).toBeTruthy();
  });

  it('rejects non-admins and anonymous requests', async () => {
    const anon = await app.inject({ method: 'GET', url: '/admin/users' });
    expect(anon.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: authHeaders(userToken),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('lists users with search and filters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users?query=user_&role=user&status=active&sort=createdAt',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.users.length).toBeGreaterThanOrEqual(1);
    expect(body.users[0]).toHaveProperty('role');
    expect(body.users[0]).toHaveProperty('status');
    expect(typeof body.total).toBe('number');
  });

  it('rejects an admin acting on their own account', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: authHeaders(adminToken),
    });
    const myId = me.json().id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${myId}`,
      headers: authHeaders(adminToken),
      payload: { action: 'demote' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('promotes, suspends, and unsuspends a user with audit rows', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/admin/users?query=user_',
      headers: authHeaders(adminToken),
    });
    userId = list
      .json()
      .users.find((u: { username: string }) => u.username === `user_${suffix}`).id;

    const promote = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${userId}`,
      headers: authHeaders(adminToken),
      payload: { action: 'promote' },
    });
    expect(promote.statusCode).toBe(200);

    const demote = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${userId}`,
      headers: authHeaders(adminToken),
      payload: { action: 'demote' },
    });
    expect(demote.statusCode).toBe(200);

    const suspend = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${userId}`,
      headers: authHeaders(adminToken),
      payload: { action: 'suspend' },
    });
    expect(suspend.statusCode).toBe(200);

    const unsuspend = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${userId}`,
      headers: authHeaders(adminToken),
      payload: { action: 'unsuspend' },
    });
    expect(unsuspend.statusCode).toBe(200);

    const audit = await app.inject({
      method: 'GET',
      url: `/admin/audit?limit=50&action=user`,
      headers: authHeaders(adminToken),
    });
    const actions = audit.json().entries.map((e: { action: string }) => e.action);
    expect(actions).toContain('user.promote');
    expect(actions).toContain('user.demote');
    expect(actions).toContain('user.suspend');
    expect(actions).toContain('user.unsuspend');
  });

  it('lists and revokes a session', async () => {
    const sessions = await app.inject({
      method: 'GET',
      url: `/admin/users/${userId}/sessions`,
      headers: authHeaders(adminToken),
    });
    expect(sessions.statusCode).toBe(200);
    const sessionId = sessions.json().sessions[0].id;
    expect(sessionId).toBeTruthy();

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/admin/sessions/${sessionId}`,
      headers: authHeaders(adminToken),
    });
    expect(revoke.statusCode).toBe(200);
  });

  it('blocks a suspended user and a revoked session immediately', async () => {
    const email = `lockout-${suffix}@sinc.dev`;
    const token = await registerUser(email, `lockout_${suffix}`);
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: authHeaders(token),
    });
    expect(res.statusCode).toBe(200);

    const victim = await prisma.user.findUnique({ where: { email } });
    expect(victim).toBeTruthy();

    await app.inject({
      method: 'PATCH',
      url: `/admin/users/${victim!.id}`,
      headers: authHeaders(adminToken),
      payload: { action: 'suspend' },
    });
    const suspended = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: authHeaders(token),
    });
    expect(suspended.statusCode).toBe(403);

    await app.inject({
      method: 'PATCH',
      url: `/admin/users/${victim!.id}`,
      headers: authHeaders(adminToken),
      payload: { action: 'unsuspend' },
    });
    const restored = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: authHeaders(token),
    });
    expect(restored.statusCode).toBe(200);

    const sessions = await app.inject({
      method: 'GET',
      url: `/admin/users/${victim!.id}/sessions`,
      headers: authHeaders(adminToken),
    });
    const sessionId = sessions.json().sessions[0].id;
    await app.inject({
      method: 'DELETE',
      url: `/admin/sessions/${sessionId}`,
      headers: authHeaders(adminToken),
    });
    const revoked = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: authHeaders(token),
    });
    expect(revoked.statusCode).toBe(401);

    await prisma.user.deleteMany({ where: { email } });
  });

  it('returns user detail with per-user activity counts', async () => {
    const detail = await app.inject({
      method: 'GET',
      url: `/admin/users/${userId}/detail`,
      headers: authHeaders(adminToken),
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.user.id).toBe(userId);
    expect(typeof body.sessionCount).toBe('number');
    expect(typeof body.favorites).toBe('number');
    expect(typeof body.playlists).toBe('number');
    expect(typeof body.downloads).toBe('number');
  });

  it('returns stats overview and activity', async () => {
    const overview = await app.inject({
      method: 'GET',
      url: '/admin/stats/overview',
      headers: authHeaders(adminToken),
    });
    expect(overview.statusCode).toBe(200);
    const stats = overview.json();
    expect(stats.users).toBeGreaterThanOrEqual(2);
    expect(stats.admins).toBeGreaterThanOrEqual(1);
    expect(typeof stats.historyRows).toBe('number');
    expect(typeof stats.visitsTotal).toBe('number');

    const activity = await app.inject({
      method: 'GET',
      url: '/admin/stats/activity?days=7',
      headers: authHeaders(adminToken),
    });
    expect(activity.statusCode).toBe(200);
    const days = activity.json();
    expect(days.length).toBe(7);
    expect(typeof days[0].visits).toBe('number');
    expect(typeof days[0].activeUsers).toBe('number');

    const top = await app.inject({
      method: 'GET',
      url: '/admin/stats/top?limit=5',
      headers: authHeaders(adminToken),
    });
    expect(top.statusCode).toBe(200);
    expect(Array.isArray(top.json().tracks)).toBe(true);
    expect(Array.isArray(top.json().artists)).toBe(true);
  });

  it('forces a password reset token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${userId}/reset-password`,
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
  });

  it('lists download jobs, stats, retry, and cancel', async () => {
    const labeled = `j-${suffix}`;
    await prisma.downloadJob.create({
      data: {
        userId,
        trackId: 'itunes:1',
        trackTitle: `Failed ${labeled}`,
        trackArtist: 'Admin Test',
        quality: 'high',
        status: 'failed',
        errorCode: 'DOWNLOAD_FAILED',
        errorMessage: 'network error',
      },
    });
    await prisma.downloadJob.create({
      data: {
        userId,
        trackId: 'itunes:2',
        trackTitle: `Completed ${labeled}`,
        trackArtist: 'Admin Test',
        quality: 'high',
        status: 'completed',
        progress: 100,
      },
    });

    const list = await app.inject({
      method: 'GET',
      url: `/admin/downloads?status=failed&query=${encodeURIComponent(labeled)}`,
      headers: authHeaders(adminToken),
    });
    expect(list.statusCode).toBe(200);
    const failedId = list.json().jobs[0].id;
    expect(list.json().jobs[0].status).toBe('failed');

    const stats = await app.inject({
      method: 'GET',
      url: '/admin/downloads/stats',
      headers: authHeaders(adminToken),
    });
    expect(stats.statusCode).toBe(200);
    expect(typeof stats.json().successRate).toBe('number');

    const retry = await app.inject({
      method: 'POST',
      url: `/admin/downloads/${failedId}/retry`,
      headers: authHeaders(adminToken),
    });
    expect(retry.statusCode).toBe(200);

    const cancel = await app.inject({
      method: 'POST',
      url: `/admin/downloads/${failedId}/cancel`,
      headers: authHeaders(adminToken),
    });
    expect(cancel.statusCode).toBe(200);

    const audit = await app.inject({
      method: 'GET',
      url: '/admin/audit?action=download',
      headers: authHeaders(adminToken),
    });
    const actions = audit.json().entries.map((e: { action: string }) => e.action);
    expect(actions).toContain('download.retry');
    expect(actions).toContain('download.cancel');
  });

  it('lists and revokes devices', async () => {
    const row = await prisma.device.create({
      data: {
        userId,
        name: `Device ${suffix}`,
        platform: 'android',
      },
    });
    deviceId = row.id;

    const list = await app.inject({
      method: 'GET',
      url: '/admin/devices',
      headers: authHeaders(adminToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().devices.some((d: { id: string }) => d.id === deviceId)).toBe(true);

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/admin/devices/${deviceId}`,
      headers: authHeaders(adminToken),
    });
    expect(revoke.statusCode).toBe(200);

    const audit = await app.inject({
      method: 'GET',
      url: '/admin/audit?action=device',
      headers: authHeaders(adminToken),
    });
    const actions = audit.json().entries.map((e: { action: string }) => e.action);
    expect(actions).toContain('device.revoke');
  });

  it('returns system health and cache sizes', async () => {
    const sys = await app.inject({
      method: 'GET',
      url: '/admin/system',
      headers: authHeaders(adminToken),
    });
    expect(sys.statusCode).toBe(200);
    const body = sys.json();
    expect(body.dbStatus).toBe('ok');
    expect(typeof body.uptimeSec).toBe('number');
    expect(typeof body.nodeVersion).toBe('string');

    const caches = await app.inject({
      method: 'GET',
      url: '/admin/caches',
      headers: authHeaders(adminToken),
    });
    expect(caches.statusCode).toBe(200);
    expect(typeof caches.json().lyrics).toBe('number');
  });

  it('returns reliability analytics', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/reliability?days=7',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.searches).toBeGreaterThanOrEqual(0);
    expect(
      body.rates.playbackCompletionRate === null ||
        typeof body.rates.playbackCompletionRate === 'number'
    ).toBe(true);
  });

  it('deletes a user with audit row', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${userId}`,
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);

    const audit = await app.inject({
      method: 'GET',
      url: '/admin/audit?limit=10&action=user.delete',
      headers: authHeaders(adminToken),
    });
    const actions = audit.json().entries.map((e: { action: string }) => e.action);
    expect(actions).toContain('user.delete');
  });
});
