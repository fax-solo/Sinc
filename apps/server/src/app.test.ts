import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const app = await buildApp(loadEnv());

afterAll(async () => {
  await app.close();
});

describe('app assembly', () => {
  it('serves the root and health endpoints', async () => {
    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.json().name).toBe('Sinc API');

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().status).toBe('ok');

    const appVersion = await app.inject({ method: 'GET', url: '/app/version' });
    expect(appVersion.statusCode).toBe(200);
    expect(typeof appVersion.json().minAppVersion).toBe('string');
  });

  it('answers unknown routes with a JSON 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/no/such/route' });
    expect(res.statusCode).toBe(404);
    expect(() => res.json()).not.toThrow();
  });

  it('echoes the request origin in CORS headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/app/version',
      headers: { origin: 'https://example.com' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('https://example.com');
  });

  it('hides /metrics unless METRICS_ENABLED is set', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(404);
  });
});
