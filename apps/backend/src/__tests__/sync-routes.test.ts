import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { buildApp, type TypedApp } from '../app.js';
import { buildContainer, type Container } from '../container.js';
import { buildTestEnv } from './health.test.js';
import type { LightMyRequestResponse } from 'fastify';
import type { ApiSuccess } from '@sinc/shared';

function buildTestApp() {
  const env = { ...buildTestEnv(), STREAM_SIGNING_SECRET: 'fixed-test-secret-0123456789' };
  const container = buildContainer({
    env,
    repositories: {
      user: { create: vi.fn() } as never,
      session: { create: vi.fn() } as never,
      device: { create: vi.fn() } as never,
      verificationToken: { create: vi.fn() } as never,
      notification: { create: vi.fn() } as never,
    },
    redis: null,
    db: null,
  });
  return { env, container };
}

describe('sync routes', () => {
  let app: TypedApp;
  let container: Container;

  beforeAll(async () => {
    const built = buildTestApp();
    container = built.container;
    app = await buildApp({ env: built.env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function authedRequest(
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
  ): Promise<LightMyRequestResponse> {
    const { token } = await container.tokenService.issueAccessToken('user-1', 'USER');
    return app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      payload: body as never,
    });
  }

  it('rejects unauthenticated requests', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/sync/snapshot' });
    expect(response.statusCode).toBe(401);
  });

  it('returns an empty snapshot for a fresh user', async () => {
    const response = await authedRequest('GET', '/api/v1/sync/snapshot');
    expect(response.statusCode).toBe(200);
    const payload = response.json<ApiSuccess<{ playlists: unknown[]; favorites: unknown[] }>>();
    expect(payload.data.playlists).toEqual([]);
    expect(payload.data.favorites).toEqual([]);
  });

  it('applies mutations and returns the converged snapshot', async () => {
    const response = await authedRequest('POST', '/api/v1/sync/apply', {
      mutations: [
        {
          kind: 'playlistUpsert',
          opId: 'op-create',
          playlistId: 'p1',
          baseVersion: 0,
          name: 'Road Trip',
          trackIds: ['t1', 't2'],
          createdAt: 1_000_000,
        },
        {
          kind: 'favoriteToggle',
          opId: 'op-fav',
          targetType: 'track',
          targetId: 't1',
          addedAt: 1_000_000,
        },
      ],
    });
    expect(response.statusCode).toBe(200);
    const payload =
      response.json<
        ApiSuccess<{
          applied: string[];
          conflicts: unknown[];
          snapshot: { playlists: Array<{ version: number }>; favorites: unknown[] };
        }>
      >();
    expect(payload.data.applied).toEqual(['op-create', 'op-fav']);
    expect(payload.data.conflicts).toEqual([]);
    expect(payload.data.snapshot.playlists[0]?.version).toBe(1);
    expect(payload.data.snapshot.favorites).toHaveLength(1);
  });

  it('reports playlist version conflicts without failing the request', async () => {
    await authedRequest('POST', '/api/v1/sync/apply', {
      mutations: [
        {
          kind: 'playlistUpsert',
          opId: 'op-1',
          playlistId: 'p1',
          baseVersion: 0,
          name: 'A',
          trackIds: [],
          createdAt: 1_000_000,
        },
      ],
    });
    const response = await authedRequest('POST', '/api/v1/sync/apply', {
      mutations: [
        {
          kind: 'playlistUpsert',
          opId: 'op-2',
          playlistId: 'p1',
          baseVersion: 0,
          name: 'Stale',
          trackIds: [],
          createdAt: 1_000_000,
        },
      ],
    });
    expect(response.statusCode).toBe(200);
    const payload =
      response.json<
        ApiSuccess<{ applied: string[]; conflicts: Array<{ kind: string; serverVersion: number }> }>
      >();
    expect(payload.data.applied).toEqual([]);
    expect(payload.data.conflicts[0]?.kind).toBe('playlistVersion');
    expect(payload.data.conflicts[0]?.serverVersion).toBe(1);
  });

  it('rejects malformed mutation bodies', async () => {
    const response = await authedRequest('POST', '/api/v1/sync/apply', {
      mutations: [{ kind: 'playlistUpsert', opId: '', playlistId: '', baseVersion: -1 }],
    });
    expect(response.statusCode).toBe(400);
  });
});
