import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp, type TypedApp } from '../app.js';
import type { ApiSuccess } from '@sinc/shared';

describe('health route', () => {
  let app: TypedApp;

  beforeAll(async () => {
    app = await buildApp({ env: { ...buildTestEnv() } });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ok with requestId', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json<ApiSuccess<{ status: string }>>();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.requestId).toBeTruthy();
  });

  it('echoes a client-supplied request id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'abc-123' },
    });
    const body = res.json<ApiSuccess<{ status: string }>>();
    expect(body.requestId).toBe('abc-123');
  });

  it('returns detail when requested', async () => {
    const res = await app.inject({ method: 'GET', url: '/health?detail=true' });
    const body = res.json<ApiSuccess<{ status: string; environment: string }>>();
    expect(body.data.environment).toBe('test');
  });

  it('is reachable at the mounted prefix-free path', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});

export function buildTestEnv() {
  return {
    NODE_ENV: 'test' as const,
    HOST: '127.0.0.1',
    PORT: 0,
    LOG_LEVEL: 'info' as const,
    DATABASE_URL: 'postgresql://sinc:sinc@localhost:5432/sinc?schema=public',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_REFRESH_TTL_DAYS: 30,
    VERIFY_EMAIL_TTL_HOURS: 24,
    PASSWORD_RESET_TTL_MINUTES: 30,
    APP_BASE_URL: 'https://sinc.test',
  };
}
