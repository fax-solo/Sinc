import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';

const app = await buildApp();

// Second app with metrics enabled, to prove the /metrics gate both ways.
const metricsApp = await buildApp({ ...loadEnv(), METRICS_ENABLED: true });

afterAll(async () => {
  await app.close();
  await metricsApp.close();
});

describe('health module', () => {
  it('GET /health reports ok when the database is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('GET / returns app metadata', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Sinc API');
  });

  it('GET /app/version exposes the min app version contract', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/version' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.minAppVersion).toBe(loadEnv().MIN_APP_VERSION);
  });

  it('GET /metrics is disabled by default', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /metrics serves Prometheus text when enabled', async () => {
    await metricsApp.inject({ method: 'GET', url: '/health' });
    const res = await metricsApp.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('sinc_http_requests_total');
  });
});
