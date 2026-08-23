import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';

const app = await buildApp();
const suffix = randomUUID().slice(0, 8);
const email = `test-${suffix}@sinc.dev`;
const username = `test_${suffix}`;
const password = 'correct-horse-battery';

const registerBody = { email, username, password, displayName: 'Test User' };

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } }).catch(() => undefined);
  await app.close();
});

describe('auth module', () => {
  it('registers a user and returns tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: registerBody,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe(email);
    expect(body.user.username).toBe(username);
    expect(body.tokens.accessToken).toBeTruthy();
    expect(body.tokens.refreshToken).toBeTruthy();
    expect(body.tokens.expiresIn).toBeGreaterThan(0);
  });

  it('rejects a duplicate registration', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: registerBody,
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a login with a wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('logs in and hits /auth/me with the access token', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    const { tokens } = login.json();

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(email);
  });

  it('blocks /auth/me without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('refreshes tokens and rejects the rotated refresh token', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    const { tokens } = login.json();

    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(refresh.statusCode).toBe(200);
    const rotated = refresh.json().tokens.refreshToken;
    expect(rotated).not.toBe(tokens.refreshToken);

    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it('logs out and then rejects the refresh token', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    const { tokens } = login.json();

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(logout.statusCode).toBe(200);

    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });
});
