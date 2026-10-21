import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, bootstrapAdmin } from '../../app.js';
import { loadEnv } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';

const app = await buildApp();
const suffix = randomUUID().slice(0, 8);
const adminEmail = `diag-admin-${suffix}@sinc.dev`;
const userEmail = `diag-user-${suffix}@sinc.dev`;
const password = 'correct-horse-battery';

async function registerUser(email: string, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, username, password, displayName: 'Test User' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().tokens.accessToken as string;
}

const authHeaders = (token: string) => ({ authorization: `Bearer ${token}` });

let adminToken = '';
let userToken = '';
let userId = '';

afterAll(async () => {
  await prisma.user
    .deleteMany({ where: { email: { in: [adminEmail, userEmail] } } })
    .catch(() => undefined);
  await app.close();
});

describe('music recommendations diagnostics admin-gate', () => {
  it('bootstraps an admin and a regular user', async () => {
    await registerUser(adminEmail, `diag_admin_${suffix}`);
    const userRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: userEmail,
        username: `diag_user_${suffix}`,
        password,
        displayName: 'Test User',
      },
    });
    expect(userRes.statusCode).toBe(201);
    userId = userRes.json().user.id as string;
    await bootstrapAdmin({ ...loadEnv(), ADMIN_BOOTSTRAP_EMAIL: adminEmail });

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: adminEmail, password },
    });
    adminToken = adminLogin.json().tokens.accessToken as string;
    const userLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: userEmail, password },
    });
    userToken = userLogin.json().tokens.accessToken as string;
    expect(adminToken).toBeTruthy();
    expect(userToken).toBeTruthy();
  });

  it('rejects anonymous and non-admin access to diagnostics', async () => {
    const anon = await app.inject({
      method: 'GET',
      url: '/admin/recommendations/diagnostics',
    });
    expect(anon.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: 'GET',
      url: `/admin/recommendations/diagnostics?userId=${userId}`,
      headers: authHeaders(userToken),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('requires a userId once the admin gate passes', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: '/admin/recommendations/diagnostics',
      headers: authHeaders(adminToken),
    });
    expect(missing.statusCode).toBe(400);
  });

  it('accepts an admin request for a real user (degraded feed when providers are unreachable)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/admin/recommendations/diagnostics?userId=${userId}`,
        headers: authHeaders(adminToken),
      });
      // The gate passed: 200 (degraded but successful diagnostics) or a
      // provider 5xx reached after the admin guard.
      expect([200, 502, 504]).toContain(res.statusCode);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
