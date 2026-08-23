import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';

const app = await buildApp();
const suffix = randomUUID().slice(0, 8);
const email = `analytics-${suffix}@sinc.dev`;
const password = 'correct-horse-battery';

async function login(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return res.json().tokens.accessToken as string;
}

function headers(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } }).catch(() => undefined);
  await app.close();
});

describe('analytics module', () => {
  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, username: `analytics_${suffix}`, password, displayName: 'Analytics User' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('defaults to opted out and drops events', async () => {
    const token = await login();

    const prefs = await app.inject({
      method: 'GET',
      url: '/analytics/preferences',
      headers: headers(token),
    });
    expect(prefs.json()).toEqual({ enabled: false });

    const recorded = await app.inject({
      method: 'POST',
      url: '/analytics/events',
      headers: headers(token),
      payload: { events: [{ event: 'playback:start', entityId: 'track-1', meta: { seconds: 3 } }] },
    });
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json()).toEqual({ recorded: 0 });

    const user = await prisma.user.findUnique({ where: { email } });
    const count = await prisma.analyticsEvent.count({ where: { userId: user!.id } });
    expect(count).toBe(0);
  });

  it('records events after opting in and persists the preference', async () => {
    const token = await login();
    const user = await prisma.user.findUnique({ where: { email } });

    const enabled = await app.inject({
      method: 'PUT',
      url: '/analytics/preferences',
      headers: headers(token),
      payload: { enabled: true },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toEqual({ enabled: true });

    const recorded = await app.inject({
      method: 'POST',
      url: '/analytics/events',
      headers: headers(token),
      payload: {
        events: [
          { event: 'playback:complete', entityId: 'track-1', meta: { completed: true } },
          { event: 'lyrics:matched', entityId: 'track-2' },
        ],
      },
    });
    expect(recorded.json()).toEqual({ recorded: 2 });

    const rows = await prisma.analyticsEvent.findMany({
      where: { userId: user!.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => r.event)).toEqual(['playback:complete', 'lyrics:matched']);
    expect(rows[0].entityId).toBe('track-1');
    expect(rows[0].meta).toEqual({ completed: true });
  });

  it('rejects unknown events and empty batches', async () => {
    const token = await login();

    const bad = await app.inject({
      method: 'POST',
      url: '/analytics/events',
      headers: headers(token),
      payload: { events: [{ event: 'evil:hax' }] },
    });
    expect(bad.statusCode).toBe(400);

    const empty = await app.inject({
      method: 'POST',
      url: '/analytics/events',
      headers: headers(token),
      payload: { events: [] },
    });
    expect(empty.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/analytics/preferences' });
    expect(res.statusCode).toBe(401);
  });
});
