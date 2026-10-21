import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { DEMO_EMAIL } from '../auth/demo.js';

const enabledEnv = { ...loadEnv(), DEMO_LOGIN_ENABLED: true };
const disabledEnv = { ...loadEnv(), DEMO_LOGIN_ENABLED: false };

const app = await buildApp(enabledEnv);
const appDisabled = await buildApp(disabledEnv);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } }).catch(() => undefined);
  await app.close();
  await appDisabled.close();
});

describe('demo account', () => {
  it('advertises demo mode via /app/version', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/version' });
    expect(res.statusCode).toBe(200);
    expect(res.json().demoEnabled).toBe(true);
  });

  it('hides demo mode when disabled', async () => {
    const res = await appDisabled.inject({ method: 'GET', url: '/app/version' });
    expect(res.statusCode).toBe(200);
    expect(res.json().demoEnabled).toBe(false);
  });

  it('provisions the demo account and returns working tokens', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/demo' });
    expect(res.statusCode).toBe(200);
    const { user, tokens } = res.json();
    expect(user.email).toBe(DEMO_EMAIL);
    expect(user.username).toBe('demo');
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(DEMO_EMAIL);
  });

  it('seeds persistent favorites, history, and a playlist for the demo user', async () => {
    const user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
    expect(user).not.toBeNull();
    const [favorites, history, playlists] = await Promise.all([
      prisma.favorite.count({ where: { userId: user!.id } }),
      prisma.history.count({ where: { userId: user!.id } }),
      prisma.playlist.count({ where: { userId: user!.id } }),
    ]);
    expect(favorites).toBeGreaterThan(0);
    expect(history).toBeGreaterThan(0);
    expect(playlists).toBe(1);
  });

  it('does not expose POST /auth/demo when disabled', async () => {
    const res = await appDisabled.inject({ method: 'POST', url: '/auth/demo' });
    expect(res.statusCode).toBe(404);
  });
});
