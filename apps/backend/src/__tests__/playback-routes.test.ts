import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp, type TypedApp } from '../app.js';
import { buildContainer, type Container } from '../container.js';
import { buildTestEnv } from './health.test.js';
import {
  NotFoundError,
  type ApiErrorBody,
  type ApiSuccess,
  type CanonicalTrack,
  type PlaybackResolveResult,
  type SourceCandidate,
  type SourceInfo,
} from '@sinc/shared';
import type { CatalogService } from '../domain/catalog/catalog.service.js';
import type { SourceProvider } from '../domain/catalog/types.js';

function canonicalTrack(overrides: Partial<CanonicalTrack> = {}): CanonicalTrack {
  return {
    id: 'TRACK1',
    title: 'Hotel California',
    normalizedTitle: 'hotel california',
    artists: [{ id: 'A1', name: 'Eagles' }],
    durationMs: 391000,
    artworkUrl: 'http://art',
    isrc: 'USMC17638786',
    releaseDate: '1976-12-08',
    explicit: false,
    version: undefined,
    trackNumber: 1,
    discNumber: 1,
    language: undefined,
    popularityScore: 0.9,
    providerIds: { musicbrainz: 'rec-1' },
    providerConfidence: 0.95,
    ...overrides,
  };
}

const summary = { attempted: ['musicbrainz'], succeeded: ['musicbrainz'], failed: [] };

function buildFakeSourceProvider(behavior: 'ok' | 'no-candidates' | 'fails'): SourceProvider {
  return {
    id: 'fake-src',
    type: 'source',
    checkAvailability: vi.fn(async (): Promise<SourceInfo[]> => []),
    resolveSources: vi.fn(async (): Promise<SourceCandidate[]> => {
      if (behavior === 'fails') throw new Error('provider exploded');
      if (behavior === 'no-candidates') return [];
      return [
        {
          provider: 'fake-src',
          externalId: 'ext-1',
          title: 'Hotel California',
          artistNames: ['Eagles'],
          durationMs: 391000,
          isrc: 'USMC17638786',
          url: 'https://cdn.example/stream.mp3',
          format: 'mp3',
          licenseType: 'permitted',
          sourceReliability: 1,
        },
      ];
    }),
  };
}

function buildTestApp(behavior: 'ok' | 'no-candidates' | 'fails' | 'no-providers' = 'ok') {
  const env = { ...buildTestEnv(), STREAM_SIGNING_SECRET: 'fixed-test-secret-0123456789' };
  const catalog = {
    getTrackDetail: vi.fn(async (id: string) => ({
      track: canonicalTrack({ providerIds: { musicbrainz: id } }),
      providers: summary,
    })),
  };
  const sourceProviders = behavior === 'no-providers' ? [] : [buildFakeSourceProvider(behavior)];
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
    catalog: catalog as unknown as CatalogService,
    sourceProviders,
  });
  return { env, container, catalog };
}

describe('playback routes', () => {
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

  async function authedGet(url: string, deviceId = 'device-playback-1') {
    const { token } = await container.tokenService.issueAccessToken('user-1', 'USER');
    return app.inject({
      method: 'GET',
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}`, 'x-device-id': deviceId },
    });
  }

  it('resolve requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/playback/tracks/rec-1/resolve' });
    expect(res.statusCode).toBe(401);
  });

  it('resolve returns a signed stream URL for a confident source', async () => {
    const res = await authedGet('/playback/tracks/rec-1/resolve');
    expect(res.statusCode).toBe(200);
    const body = res.json<ApiSuccess<PlaybackResolveResult>>();
    expect(body.data.track.id).toBe('TRACK1');
    expect(body.data.confidence).toBe(1);
    expect(body.data.source.type).toBe('remote');
    expect(body.data.source.mimeType).toBe('audio/mpeg');
    expect(body.data.source.uri).toContain('https://sinc.test/api/v1/playback/stream?url=');
    expect(body.data.source.uri).toContain('&exp=');
    expect(body.data.source.uri).toContain('&sig=');
    expect(body.data.expiresAt).toBeGreaterThan(Date.now());
  });

  it('stream redirects to the provider URL for a valid signature', async () => {
    const resolve = await authedGet('/playback/tracks/rec-1/resolve');
    const uri = resolve.json<ApiSuccess<PlaybackResolveResult>>().data.source.uri;
    const params = new URL(uri);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/playback/stream?url=${params.searchParams.get('url')}&exp=${params.searchParams.get('exp')}&sig=${params.searchParams.get('sig')}`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://cdn.example/stream.mp3');
  });

  it('stream rejects a tampered signature', async () => {
    const resolve = await authedGet('/playback/tracks/rec-1/resolve');
    const uri = resolve.json<ApiSuccess<PlaybackResolveResult>>().data.source.uri;
    const params = new URL(uri);
    const sig = params.searchParams.get('sig')!;
    const tampered = `${sig.slice(0, -1)}0`;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/playback/stream?url=${params.searchParams.get('url')}&exp=${params.searchParams.get('exp')}&sig=${tampered}`,
    });
    expect(res.statusCode).toBe(403);
    const body = res.json<ApiErrorBody>();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('stream rejects an expired signature', async () => {
    const resolve = await authedGet('/playback/tracks/rec-1/resolve');
    const uri = resolve.json<ApiSuccess<PlaybackResolveResult>>().data.source.uri;
    const params = new URL(uri);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/playback/stream?url=${params.searchParams.get('url')}&exp=${Number(params.searchParams.get('exp')) - 999_999}&sig=${params.searchParams.get('sig')}`,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('playback degradation', () => {
  it.each([
    ['no providers registered', 'no-providers'],
    ['providers report no candidates', 'no-candidates'],
  ] as const)('resolve returns 404 when %s', async (_label, behavior) => {
    const built = buildTestApp(behavior);
    const app = await buildApp({ env: built.env, container: built.container });
    await app.ready();
    const { token } = await built.container.tokenService.issueAccessToken('user-1', 'USER');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/playback/tracks/rec-1/resolve',
      headers: { authorization: `Bearer ${token}`, 'x-device-id': 'device-degrade-1' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json<ApiErrorBody>();
    expect(body.error.code).toBe('NOT_FOUND');
    await app.close();
  });

  it('resolve returns 502 when every source provider fails', async () => {
    const built = buildTestApp('fails');
    const app = await buildApp({ env: built.env, container: built.container });
    await app.ready();
    const { token } = await built.container.tokenService.issueAccessToken('user-1', 'USER');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/playback/tracks/rec-1/resolve',
      headers: { authorization: `Bearer ${token}`, 'x-device-id': 'device-degrade-2' },
    });
    expect(res.statusCode).toBe(502);
    const body = res.json<ApiErrorBody>();
    expect(body.error.code).toBe('PROVIDER_ERROR');
    await app.close();
  });

  it('resolve surfaces metadata failures unchanged', async () => {
    const built = buildTestApp('ok');
    built.catalog.getTrackDetail.mockRejectedValue(new NotFoundError('Unknown track'));
    const app = await buildApp({ env: built.env, container: built.container });
    await app.ready();
    const { token } = await built.container.tokenService.issueAccessToken('user-1', 'USER');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/playback/tracks/unknown/resolve',
      headers: { authorization: `Bearer ${token}`, 'x-device-id': 'device-degrade-3' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
