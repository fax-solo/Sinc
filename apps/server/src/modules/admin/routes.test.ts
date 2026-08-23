import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, bootstrapAdmin } from '../../app.js';
import { loadEnv } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { totpCode } from '../../lib/totp.js';

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

function authHeaders(token: string, otp?: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...(otp ? { 'x-admin-otp': otp } : {}) };
}

let adminToken = '';
let userToken = '';
let userId = '';

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

  it('lists users with search', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users?query=user_',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.users.length).toBeGreaterThanOrEqual(1);
    expect(body.users[0]).toHaveProperty('role');
    expect(body.users[0]).toHaveProperty('status');
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
      url: `/admin/audit?limit=50`,
      headers: authHeaders(adminToken),
    });
    const actions = audit.json().entries.map((e: { action: string }) => e.action);
    expect(actions).toContain('user.promote');
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

  describe('MFA', () => {
    let secret = '';

    it('enrolls an admin with a fresh TOTP secret', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/mfa/enroll',
        headers: authHeaders(adminToken),
      });
      expect(res.statusCode).toBe(200);
      secret = res.json().secret as string;
      expect(res.json().otpauthUrl).toContain('otpauth://totp/');
    });

    it('rejects an invalid verification code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/mfa/verify',
        headers: authHeaders(adminToken),
        payload: { code: '000000' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('enables MFA with a valid code', async () => {
      const code = totpCode(secret);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/mfa/verify',
        headers: authHeaders(adminToken),
        payload: { code },
      });
      expect(res.statusCode).toBe(200);
    });

    it('blocks destructive writes without a valid MFA code once enabled', async () => {
      const blocked = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${userId}`,
        headers: authHeaders(adminToken),
        payload: { action: 'suspend' },
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().message).toContain('MFA');

      const wrong = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${userId}`,
        headers: authHeaders(adminToken, '000000'),
        payload: { action: 'suspend' },
      });
      expect(wrong.statusCode).toBe(403);

      const ok = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${userId}`,
        headers: authHeaders(adminToken, totpCode(secret)),
        payload: { action: 'suspend' },
      });
      expect(ok.statusCode).toBe(200);

      const audit = await app.inject({
        method: 'GET',
        url: '/admin/audit?limit=10',
        headers: authHeaders(adminToken),
      });
      const actions = audit.json().entries.map((e: { action: string }) => e.action);
      expect(actions).toContain('mfa.enable');
    });

    it('deletes a user with MFA', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/admin/users/${userId}`,
        headers: authHeaders(adminToken, totpCode(secret)),
      });
      expect(res.statusCode).toBe(200);

      const audit = await app.inject({
        method: 'GET',
        url: '/admin/audit?limit=10',
        headers: authHeaders(adminToken),
      });
      const actions = audit.json().entries.map((e: { action: string }) => e.action);
      expect(actions).toContain('user.delete');
    });
  });
});
