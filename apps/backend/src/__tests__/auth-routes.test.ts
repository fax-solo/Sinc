import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp, type TypedApp } from '../app.js';
import { buildContainer, type Container } from '../container.js';
import { buildTestEnv } from './health.test.js';
import type { ApiSuccess, ApiErrorBody } from '@sinc/shared';
import {
  MemoryUserRepository,
  MemorySessionRepository,
  MemoryDeviceRepository,
  MemoryVerificationTokenRepository,
  MemoryNotificationRepository,
  MemoryMailService,
} from '../persistence/memory-repos.js';

const DEVICE_HEADERS = { 'x-device-id': 'device-route-1', 'x-platform': 'ios' };

async function buildTestApp() {
  const env = buildTestEnv();
  const repositories = {
    user: new MemoryUserRepository(),
    session: new MemorySessionRepository(),
    device: new MemoryDeviceRepository(),
    verificationToken: new MemoryVerificationTokenRepository(),
    notification: new MemoryNotificationRepository(),
  };
  const mailService = new MemoryMailService();
  const container = buildContainer({
    env,
    repositories,
    mailService,
    redis: null,
    db: null,
  });
  const app = await buildApp({ env, container });
  await app.ready();
  return { app, container, mailService, env };
}

describe('auth routes', () => {
  let app: TypedApp;
  let container: Container;
  let mailService: MemoryMailService;

  beforeAll(async () => {
    const built = await buildTestApp();
    app = built.app;
    container = built.container;
    mailService = built.mailService;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mailService.sent = [];
  });

  it('rejects register without device headers? no - registers with defaults', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'route@example.com',
        password: 'RouteStrongPassw0rd!',
        username: 'routeuser',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<ApiSuccess<{ user: { email: string }; refreshToken: string }>>();
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe('route@example.com');
    expect(body.data.refreshToken).toBeTruthy();
  });

  it('validates bad payloads with a 400 envelope', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'not-an-email', password: 'short', username: 'x' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<ApiErrorBody>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toBeTruthy();
  });

  it('returns 409 for duplicate email', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'dupe@example.com',
        password: 'RouteStrongPassw0rd!',
        username: 'dupeuser',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'dupe@example.com',
        password: 'RouteStrongPassw0rd!',
        username: 'otheruser',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<ApiErrorBody>().error.code).toBe('CONFLICT');
  });

  it('full flow: register -> verify -> login -> me -> sessions', async () => {
    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: DEVICE_HEADERS,
      payload: { email: 'flow@example.com', password: 'FlowStrongPassw0rd!', username: 'flowuser' },
    });
    expect(register.statusCode).toBe(201);
    const registerBody = register.json<ApiSuccess<{ refreshToken: string }>>();

    // unverified login blocked
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: DEVICE_HEADERS,
      payload: { email: 'flow@example.com', password: 'FlowStrongPassw0rd!' },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json<ApiErrorBody>().error.code).toBe('EMAIL_NOT_VERIFIED');

    const verifyToken = mailService.lastUrl('verify').split('token=')[1]!;
    const verified = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      headers: DEVICE_HEADERS,
      payload: { token: verifyToken },
    });
    expect(verified.statusCode).toBe(200);
    const verifiedBody = verified.json<ApiSuccess<{ user: { username: string } }>>();
    expect(verifiedBody.data.user.username).toBe('flowuser');

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: DEVICE_HEADERS,
      payload: { email: 'flow@example.com', password: 'FlowStrongPassw0rd!' },
    });
    expect(login.statusCode).toBe(200);
    const loginBody = login.json<ApiSuccess<{ accessToken: string }>>();

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${loginBody.data.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json<ApiSuccess<{ user: { email: string } }>>().data.user.email).toBe(
      'flow@example.com',
    );

    const sessions = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { authorization: `Bearer ${loginBody.data.accessToken}` },
    });
    expect(sessions.statusCode).toBe(200);

    void registerBody;
  });

  it('rejects unauthenticated /auth/me with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json<ApiErrorBody>().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects garbage bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer garbage-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refresh rotates tokens over HTTP and logout revokes', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: DEVICE_HEADERS,
      payload: { email: 'rot@example.com', password: 'RotStrongPassw0rd!', username: 'rotuser' },
    });
    const verifyToken = mailService.lastUrl('verify').split('token=')[1]!;
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      headers: DEVICE_HEADERS,
      payload: { token: verifyToken },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: DEVICE_HEADERS,
      payload: { email: 'rot@example.com', password: 'RotStrongPassw0rd!' },
    });
    const refreshToken = login.json<ApiSuccess<{ refreshToken: string }>>().data.refreshToken;

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: DEVICE_HEADERS,
      payload: { refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const newRefresh = refreshed.json<ApiSuccess<{ refreshToken: string }>>().data.refreshToken;
    expect(newRefresh).not.toBe(refreshToken);

    // original token reuse -> reuse detection -> 401
    const reused = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: DEVICE_HEADERS,
      payload: { refreshToken },
    });
    expect(reused.statusCode).toBe(401);

    // logout with the rotated token
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: DEVICE_HEADERS,
      payload: { refreshToken: newRefresh },
    });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: DEVICE_HEADERS,
      payload: { refreshToken: newRefresh },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('password reset over HTTP', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: DEVICE_HEADERS,
      payload: {
        email: 'reset@example.com',
        password: 'ResetStrongPassw0rd!',
        username: 'resetuser',
      },
    });
    const verifyToken = mailService.lastUrl('verify').split('token=')[1]!;
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      headers: DEVICE_HEADERS,
      payload: { token: verifyToken },
    });

    const request = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      headers: DEVICE_HEADERS,
      payload: { email: 'reset@example.com' },
    });
    expect(request.statusCode).toBe(200);

    const resetToken = mailService.lastUrl('reset').split('token=')[1]!;
    const confirm = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      headers: DEVICE_HEADERS,
      payload: { token: resetToken, newPassword: 'NewResetPassw0rd!' },
    });
    expect(confirm.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: DEVICE_HEADERS,
      payload: { email: 'reset@example.com', password: 'NewResetPassw0rd!' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('rate limits repeated login attempts with 429', async () => {
    const limiter = container.rateLimiter as unknown as { resetForTest(): void };
    limiter.resetForTest();
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: DEVICE_HEADERS,
        payload: { email: 'ratelimit@example.com', password: 'WrongPassword!' },
      });
      last = res.statusCode;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe('user routes', () => {
  let app: TypedApp;
  let mailService: MemoryMailService;

  beforeAll(async () => {
    const built = await buildTestApp();
    app = built.app;
    mailService = built.mailService;
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerAndGetToken() {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: DEVICE_HEADERS,
      payload: {
        email: 'users@example.com',
        password: 'UsersStrongPassw0rd!',
        username: 'usersuser',
      },
    });
    const verifyToken = mailService.lastUrl('verify').split('token=')[1]!;
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      headers: DEVICE_HEADERS,
      payload: { token: verifyToken },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: DEVICE_HEADERS,
      payload: { email: 'users@example.com', password: 'UsersStrongPassw0rd!' },
    });
    const body = login.json<ApiSuccess<{ accessToken: string }>>();
    return body.data.accessToken;
  }

  it('patches profile', async () => {
    const token = await registerAndGetToken();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: 'Patched Name' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ApiSuccess<{ user: { displayName: string } }>>().data.user.displayName).toBe(
      'Patched Name',
    );
  });

  it('patches and reads settings', async () => {
    const token = await registerAndGetToken();
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { playback: { volumeNormalization: true } },
    });
    expect(patch.statusCode).toBe(200);
    expect(
      patch.json<ApiSuccess<{ settings: { playback: { volumeNormalization: boolean } } }>>().data
        .settings.playback.volumeNormalization,
    ).toBe(true);

    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me/settings',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.statusCode).toBe(200);
  });

  it('deletes account with password + confirmation', async () => {
    const token = await registerAndGetToken();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'UsersStrongPassw0rd!', confirmation: 'DELETE' },
    });
    expect(res.statusCode).toBe(200);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(401); // sessions revoked by deletion
  });
});
