import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp, type TypedApp } from '../app.js';
import { buildContainer, type Container } from '../container.js';
import { buildTestEnv } from './health.test.js';
import {
  NotFoundError,
  ProviderError,
  type ApiErrorBody,
  type ApiSuccess,
  type CanonicalTrack,
} from '@sinc/shared';
import type { CatalogService } from '../domain/catalog/catalog.service.js';
import type { HomeFeedService } from '../domain/home/home.service.js';

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

function buildTestApp() {
  const env = buildTestEnv();
  const catalog = {
    search: vi.fn(),
    suggest: vi.fn(),
    getTrackDetail: vi.fn(async (id: string) => ({
      track: canonicalTrack({ providerIds: { musicbrainz: id } }),
      providers: summary,
    })),
    getArtistDetail: vi.fn(async (id: string) => ({
      artist: {
        id: 'A1',
        name: 'Eagles',
        normalizedName: 'eagles',
        nameVariants: [],
        genres: ['rock'],
        providerIds: { musicbrainz: id },
      },
      topTracks: [canonicalTrack()],
      albums: [],
      relatedArtists: [],
      providers: summary,
    })),
    getAlbumDetail: vi.fn(async (id: string) => ({
      album: {
        id: 'AL1',
        title: 'Hotel California',
        normalizedTitle: 'hotel california',
        type: 'ALBUM',
        providerIds: { musicbrainz: id },
      },
      tracks: [canonicalTrack()],
      providers: summary,
    })),
    getPlaylistDetail: vi.fn(async () => {
      throw new NotFoundError('Playlists are not available yet');
    }),
    getTrackSources: vi.fn(async (id: string) => ({
      track: canonicalTrack({ providerIds: { musicbrainz: id } }),
      sources: [],
      providers: summary,
    })),
  };
  const homeFeed = {
    build: vi.fn(async (userId: string) => ({ sections: [], generatedAt: `now-${userId}` })),
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
    homeFeed: homeFeed as unknown as HomeFeedService,
  });
  return { env, container, catalog, homeFeed };
}

describe('music detail routes', () => {
  let app: TypedApp;
  let container: Container;
  let catalog: {
    getTrackDetail: ReturnType<typeof vi.fn>;
    getArtistDetail: ReturnType<typeof vi.fn>;
    getAlbumDetail: ReturnType<typeof vi.fn>;
    getPlaylistDetail: ReturnType<typeof vi.fn>;
    getTrackSources: ReturnType<typeof vi.fn>;
  };
  let homeFeed: { build: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    const built = buildTestApp();
    container = built.container;
    catalog = built.catalog;
    homeFeed = built.homeFeed;
    app = await buildApp({ env: built.env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function authedGet(url: string, deviceId = 'device-detail-1') {
    const { token } = await container.tokenService.issueAccessToken('user-1', 'USER');
    return app.inject({
      method: 'GET',
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}`, 'x-device-id': deviceId },
    });
  }

  it.each([
    '/music/tracks/rec-1',
    '/music/artists/a-1',
    '/music/albums/al-1',
    '/music/playlists/p-1',
    '/music/tracks/rec-1/sources',
    '/home',
  ])('requires authentication for %s', async (url) => {
    const res = await app.inject({ method: 'GET', url: `/api/v1${url}` });
    expect(res.statusCode).toBe(401);
  });

  it('returns a track detail', async () => {
    const res = await authedGet('/music/tracks/rec-1');
    expect(res.statusCode).toBe(200);
    const body =
      res.json<ApiSuccess<{ track: CanonicalTrack; providers: { succeeded: string[] } }>>();
    expect(body.data.track).toMatchObject({ title: 'Hotel California', isrc: 'USMC17638786' });
    expect(body.data.track.providerIds).toEqual({ musicbrainz: 'rec-1' });
    expect(body.data.providers.succeeded).toEqual(['musicbrainz']);
  });

  it('returns an artist detail with sub-lists', async () => {
    const res = await authedGet('/music/artists/a-1');
    expect(res.statusCode).toBe(200);
    const body = res.json<ApiSuccess<{ artist: { name: string }; topTracks: unknown[] }>>();
    expect(body.data.artist.name).toBe('Eagles');
    expect(body.data.topTracks).toHaveLength(1);
  });

  it('returns an album detail with tracks', async () => {
    const res = await authedGet('/music/albums/al-1');
    expect(res.statusCode).toBe(200);
    const body = res.json<ApiSuccess<{ album: { title: string }; tracks: unknown[] }>>();
    expect(body.data.album.title).toBe('Hotel California');
    expect(body.data.tracks).toHaveLength(1);
  });

  it('returns source availability for a track', async () => {
    const res = await authedGet('/music/tracks/rec-1/sources');
    expect(res.statusCode).toBe(200);
    const body = res.json<ApiSuccess<{ track: CanonicalTrack; sources: unknown[] }>>();
    expect(body.data.track.isrc).toBe('USMC17638786');
    expect(body.data.sources).toEqual([]);
  });

  it('returns the home feed with the requesting user', async () => {
    const res = await authedGet('/home');
    expect(res.statusCode).toBe(200);
    const body = res.json<ApiSuccess<{ sections: unknown[]; generatedAt: string }>>();
    expect(body.data.sections).toEqual([]);
    expect(homeFeed.build).toHaveBeenCalledWith('user-1');
  });

  it('maps unknown entities to the NOT_FOUND envelope', async () => {
    catalog.getTrackDetail.mockRejectedValueOnce(new NotFoundError('Track not found'));
    const res = await authedGet('/music/tracks/missing');
    expect(res.statusCode).toBe(404);
    const body = res.json<ApiErrorBody>();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('maps provider failures to the PROVIDER_ERROR envelope', async () => {
    catalog.getTrackDetail.mockRejectedValueOnce(new ProviderError('musicbrainz', 'upstream down'));
    const res = await authedGet('/music/tracks/broken');
    expect(res.statusCode).toBe(502);
    const body = res.json<ApiErrorBody>();
    expect(body.error.code).toBe('PROVIDER_ERROR');
  });

  it('playlist detail is a clean 404 until playlists exist', async () => {
    const res = await authedGet('/music/playlists/p-1');
    expect(res.statusCode).toBe(404);
    const body = res.json<ApiErrorBody>();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('rejects an empty entity id', async () => {
    const res = await authedGet('/music/tracks/');
    expect(res.statusCode).toBe(400);
  });

  it('forwards the provider pin and pagination', async () => {
    await authedGet('/music/artists/a-1?provider=musicbrainz&limit=5&offset=10');
    expect(catalog.getArtistDetail).toHaveBeenLastCalledWith('a-1', {
      provider: 'musicbrainz',
      limit: 5,
      offset: 10,
    });
  });

  it('caches identical detail requests', async () => {
    catalog.getTrackDetail.mockClear();
    await authedGet('/music/tracks/cached-id', 'device-detail-cache');
    await authedGet('/music/tracks/cached-id', 'device-detail-cache');
    expect(catalog.getTrackDetail).toHaveBeenCalledTimes(1);
  });
});
