import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp, type TypedApp } from '../app.js';
import { buildContainer, type Container } from '../container.js';
import { buildTestEnv } from './health.test.js';
import type { ApiSuccess } from '@sinc/shared';
import type { CatalogService, SearchResults } from '../domain/catalog/catalog.service.js';
import type { CanonicalTrack } from '@sinc/shared';

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

function fakeResults(overrides: Partial<SearchResults> = {}): SearchResults {
  return {
    query: 'hotel',
    tracks: [
      { track: canonicalTrack(), score: { total: 1 } as never },
      {
        track: canonicalTrack({
          id: 'TRACK2',
          title: 'New Kid in Town',
          durationMs: 318000,
          isrc: 'USMC17638787',
          popularityScore: 0.4,
        }),
        score: { total: 0.8 } as never,
      },
    ],
    artists: [
      {
        id: 'A1',
        name: 'Eagles',
        normalizedName: 'eagles',
        nameVariants: [],
        genres: ['rock'],
        providerIds: { musicbrainz: 'a1' },
      },
    ],
    albums: [
      {
        id: 'AL1',
        title: 'Hotel California',
        normalizedTitle: 'hotel california',
        type: 'ALBUM',
        releaseDate: '1976-12-08',
        releaseYear: 1976,
        providerIds: { musicbrainz: 'rg1' },
      },
    ],
    providers: { attempted: ['musicbrainz'], succeeded: ['musicbrainz'], failed: [] },
    ...overrides,
  };
}

function buildTestApp() {
  const env = buildTestEnv();
  const catalog = {
    search: vi.fn(async (query: string, _opts?: Record<string, unknown>): Promise<SearchResults> =>
      fakeResults({ query }),
    ),
    suggest: vi.fn(async (_query: string, _limit = 8) => [
      { type: 'song', id: 'TRACK1', text: 'Hotel California', subtitle: 'Eagles', score: 1 },
      { type: 'artist', id: 'A1', text: 'Eagles', subtitle: 'rock', score: 0.9 },
      { type: 'album', id: 'AL1', text: 'Hotel California', subtitle: '1976', score: 0.8 },
    ]),
  };
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
  });
  return { env, container, catalog };
}

describe('music routes', () => {
  let app: TypedApp;
  let container: Container;
  let catalog: { search: ReturnType<typeof vi.fn>; suggest: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    const built = buildTestApp();
    container = built.container;
    catalog = built.catalog;
    app = await buildApp({ env: built.env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function authedGet(url: string, deviceId = 'device-search-1') {
    const { token } = await container.tokenService.issueAccessToken('user-1', 'USER');
    return app.inject({
      method: 'GET',
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}`, 'x-device-id': deviceId },
    });
  }

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/music/search?q=hotel' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a missing query', async () => {
    const res = await authedGet('/music/search');
    expect(res.statusCode).toBe(400);
  });

  it('returns grouped, paginated results', async () => {
    const res = await authedGet('/music/search?q=hotel');
    expect(res.statusCode).toBe(200);
    const body =
      res.json<ApiSuccess<Record<string, { data: unknown[]; meta: { total: number } }>>>();
    expect(body.data.tracks?.data).toHaveLength(2);
    expect(body.data.tracks?.meta.total).toBe(2);
    expect(body.data.artists?.data).toHaveLength(1);
    expect(body.data.albums?.data).toHaveLength(1);
    expect(body.data.playlists?.data).toEqual([]);
  });

  it('respects the type filter', async () => {
    const res = await authedGet('/music/search?q=hotel&type=songs');
    const body = res.json<ApiSuccess<Record<string, { data: unknown[] }>>>();
    expect(body.data.tracks?.data.length ?? 0).toBeGreaterThan(0);
    expect(body.data.artists?.data).toEqual([]);
    expect(body.data.albums?.data).toEqual([]);
  });

  it('forwards artist/album/duration filters to the catalog', async () => {
    await authedGet('/music/search?q=hotel&artist=Eagles&album=California&durationMax=400000');
    expect(catalog.search).toHaveBeenLastCalledWith(
      'hotel',
      expect.objectContaining({
        artist: 'Eagles',
        album: 'California',
        durationMax: 400000,
      }),
    );
  });

  it('paginates and sorts the tracks group', async () => {
    const res = await authedGet('/music/search?q=hotel&page=1&limit=1&sort=title&order=asc');
    const body =
      res.json<
        ApiSuccess<{
          tracks: {
            data: Array<{ track: { title: string } }>;
            meta: { page: number; hasNext: boolean };
          };
        }>
      >();
    expect(body.data.tracks.data).toHaveLength(1);
    expect(body.data.tracks.meta.page).toBe(1);
    expect(body.data.tracks.meta.hasNext).toBe(true);
    expect(body.data.tracks.data[0]?.track.title).toBe('Hotel California');
  });

  it('caches identical searches (catalog hit once)', async () => {
    catalog.search.mockClear();
    await authedGet('/music/search?q=cachedquery', 'device-cache-1');
    await authedGet('/music/search?q=cachedquery', 'device-cache-1');
    expect(catalog.search).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent identical requests via single-flight', async () => {
    catalog.search.mockClear();
    const responses = await Promise.all([
      authedGet('/music/search?q=parallel', 'device-par-1'),
      authedGet('/music/search?q=parallel', 'device-par-1'),
      authedGet('/music/search?q=parallel', 'device-par-1'),
    ]);
    for (const res of responses) expect(res.statusCode).toBe(200);
    expect(catalog.search).toHaveBeenCalledTimes(1);
  });

  it('serves suggest results and caches them', async () => {
    catalog.suggest.mockClear();
    const res = await authedGet('/music/search/suggest?q=hotel&limit=3', 'device-sug-1');
    expect(res.statusCode).toBe(200);
    const body =
      res.json<
        ApiSuccess<{ suggestions: Array<{ type: string; text: string; subtitle?: string }> }>
      >();
    expect(body.data.suggestions).toHaveLength(3);
    expect(body.data.suggestions[0]).toMatchObject({
      type: 'song',
      text: 'Hotel California',
      subtitle: 'Eagles',
    });

    await authedGet('/music/search/suggest?q=hotel&limit=3', 'device-sug-1');
    expect(catalog.suggest).toHaveBeenCalledTimes(1);
  });

  it('rate limits search at 30/min per device', async () => {
    const deviceId = 'device-ratelimit';
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await authedGet(`/music/search?q=rl${i % 3}`, deviceId);
      lastStatus = res.statusCode;
      if (res.statusCode === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
});
