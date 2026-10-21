import { beforeEach, describe, expect, it } from 'vitest';

const original = { ...process.env };

beforeEach(() => {
  process.env = { ...original };
});

describe('loadEnv', () => {
  it('applies numeric and boolean transforms + defaults before caching', async () => {
    process.env.DEMO_LOGIN_ENABLED = 'true';
    process.env.METRICS_ENABLED = '1';
    process.env.RATE_LIMIT_ENABLED = 'false';
    process.env.PORT = '8080';

    const { loadEnv } = await import('./env.js');
    const env = loadEnv();

    expect(env.DEMO_LOGIN_ENABLED).toBe(true);
    expect(env.METRICS_ENABLED).toBe(true);
    expect(env.RATE_LIMIT_ENABLED).toBe(false);
    expect(env.PORT).toBe(8080);
    expect(env.MIN_APP_VERSION).toBeDefined();
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.DATABASE_URL).toMatch(/^postgres/);
  });

  it('caches the parsed env so getEnv returns the same object', async () => {
    const mod = await import('./env.js');
    const env = mod.loadEnv();
    expect(mod.getEnv()).toBe(env);
  });
});
