import { describe, it, expect, vi } from 'vitest';
import type { RawAlbum, RawArtist, RawTrack, SourceInfo } from '@sinc/shared';
import { CatalogService } from '../domain/catalog/catalog.service.js';
import { ProviderRegistryImpl } from '../domain/catalog/registry.js';
import type { MetadataProvider, SourceProvider } from '../domain/catalog/types.js';

function rawTrack(overrides: Partial<RawTrack> = {}): RawTrack {
  return {
    provider: 'fake',
    providerId: 't1',
    title: 'Song Title',
    artistNames: ['Artist'],
    durationMs: 200000,
    ...overrides,
  };
}

function rawArtist(overrides: Partial<RawArtist> = {}): RawArtist {
  return {
    provider: 'fake',
    providerId: 'a1',
    name: 'Artist',
    ...overrides,
  };
}

function rawAlbum(overrides: Partial<RawAlbum> = {}): RawAlbum {
  return {
    provider: 'fake',
    providerId: 'al1',
    title: 'Album Title',
    artistNames: ['Artist'],
    ...overrides,
  };
}

interface FakeMetadata {
  provider: MetadataProvider;
  getTrack: ReturnType<typeof vi.fn>;
  getArtist: ReturnType<typeof vi.fn>;
  getAlbum: ReturnType<typeof vi.fn>;
  getArtistTracks: ReturnType<typeof vi.fn>;
  getArtistAlbums: ReturnType<typeof vi.fn>;
  getAlbumTracks: ReturnType<typeof vi.fn>;
  getRelatedArtists: ReturnType<typeof vi.fn>;
}

function fakeMetadata(id: string): FakeMetadata {
  const getTrack = vi.fn(async () => null);
  const getArtist = vi.fn(async () => null);
  const getAlbum = vi.fn(async () => null);
  const getArtistTracks = vi.fn(async () => []);
  const getArtistAlbums = vi.fn(async () => []);
  const getAlbumTracks = vi.fn(async () => []);
  const getRelatedArtists = vi.fn(async () => []);
  const provider = {
    id,
    type: 'metadata',
    search: vi.fn(),
    getTrack,
    getArtist,
    getAlbum,
    getArtistTracks,
    getArtistAlbums,
    getAlbumTracks,
    getRelatedArtists,
    healthCheck: vi.fn(),
  } as unknown as MetadataProvider;
  return {
    provider,
    getTrack,
    getArtist,
    getAlbum,
    getArtistTracks,
    getArtistAlbums,
    getAlbumTracks,
    getRelatedArtists,
  };
}

function fakeSource(id: string): {
  provider: SourceProvider;
  checkAvailability: ReturnType<typeof vi.fn>;
} {
  const checkAvailability = vi.fn(async () => []);
  return {
    provider: { id, type: 'source', checkAvailability } as unknown as SourceProvider,
    checkAvailability,
  };
}

function buildService(
  metadata: FakeMetadata[],
  sources: Array<ReturnType<typeof fakeSource>> = [],
) {
  const registry = new ProviderRegistryImpl();
  for (const fake of metadata) registry.register(fake.provider);
  for (const fake of sources) registry.registerSource(fake.provider);
  return new CatalogService(registry);
}

describe('catalog detail resolution', () => {
  it('resolves a track detail from the first provider that has it', async () => {
    const first = fakeMetadata('first');
    const second = fakeMetadata('second');
    first.getTrack.mockResolvedValue(
      rawTrack({ provider: 'first', providerId: 'x-1', isrc: 'USX' }),
    );
    const catalog = buildService([first, second]);

    const result = await catalog.getTrackDetail('x-1');

    expect(result.track.id).toBeTruthy();
    expect(result.track.providerIds).toEqual({ first: 'x-1' });
    expect(result.track.isrc).toBe('USX');
    expect(result.providers).toEqual({
      attempted: ['first', 'second'],
      succeeded: ['first'],
      failed: [],
    });
  });

  it('throws NOT_FOUND when no provider knows the id', async () => {
    const first = fakeMetadata('first');
    const catalog = buildService([first]);

    await expect(catalog.getTrackDetail('unknown')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('throws PROVIDER_ERROR when every provider fails instead of 404', async () => {
    const first = fakeMetadata('first');
    first.getTrack.mockRejectedValue(new Error('musicbrainz blew up'));
    const catalog = buildService([first]);

    await expect(catalog.getTrackDetail('x-1')).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      status: 502,
    });
  });

  it('pins the lookup to a provider when requested', async () => {
    const first = fakeMetadata('first');
    const second = fakeMetadata('second');
    first.getTrack.mockResolvedValue(rawTrack({ provider: 'first', providerId: 'x-1' }));
    second.getTrack.mockResolvedValue(rawTrack({ provider: 'second', providerId: 'x-2' }));
    const catalog = buildService([first, second]);

    const result = await catalog.getTrackDetail('x-2', { provider: 'second' });

    expect(result.track.providerIds).toEqual({ second: 'x-2' });
    expect(second.getTrack).toHaveBeenCalledWith('x-2');
    expect(first.getTrack).not.toHaveBeenCalled();
  });

  it('rejects an unknown pinned provider', async () => {
    const catalog = buildService([fakeMetadata('first')]);

    await expect(catalog.getTrackDetail('x-1', { provider: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('deduplicates artist tracks across providers and keeps both provider ids', async () => {
    const first = fakeMetadata('first');
    const second = fakeMetadata('second');
    first.getArtist.mockResolvedValue(rawArtist({ provider: 'first', providerId: 'a-1' }));
    first.getArtistTracks.mockResolvedValue([
      rawTrack({ provider: 'first', providerId: 't-1', isrc: 'US1' }),
    ]);
    second.getArtistTracks.mockResolvedValue([
      rawTrack({ provider: 'second', providerId: 't-2', isrc: 'US1' }),
    ]);
    const catalog = buildService([first, second]);

    const result = await catalog.getArtistDetail('a-1');

    expect(result.artist.name).toBe('Artist');
    expect(result.topTracks).toHaveLength(1);
    expect(result.topTracks[0]?.providerIds).toEqual({ first: 't-1', second: 't-2' });
  });

  it('assembles artist albums and related artists with a merged summary', async () => {
    const first = fakeMetadata('first');
    first.getArtist.mockResolvedValue(rawArtist({ provider: 'first', providerId: 'a-1' }));
    first.getArtistAlbums.mockResolvedValue([rawAlbum({ provider: 'first', providerId: 'al-1' })]);
    first.getRelatedArtists.mockResolvedValue([
      rawArtist({ provider: 'first', providerId: 'r-1', name: 'Related' }),
    ]);
    const catalog = buildService([first]);

    const result = await catalog.getArtistDetail('a-1');

    expect(result.albums).toHaveLength(1);
    expect(result.relatedArtists).toHaveLength(1);
    expect(result.providers.attempted).toEqual(['first']);
  });

  it('throws NOT_FOUND for an unknown artist', async () => {
    const catalog = buildService([fakeMetadata('first')]);
    await expect(catalog.getArtistDetail('unknown')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns an album with deduplicated tracks', async () => {
    const first = fakeMetadata('first');
    const second = fakeMetadata('second');
    first.getAlbum.mockResolvedValue(rawAlbum({ provider: 'first', providerId: 'al-1' }));
    first.getAlbumTracks.mockResolvedValue([rawTrack({ provider: 'first', providerId: 't-1' })]);
    second.getAlbumTracks.mockResolvedValue([rawTrack({ provider: 'second', providerId: 't-2' })]);
    const catalog = buildService([first, second]);

    const result = await catalog.getAlbumDetail('al-1');

    expect(result.album.providerIds).toEqual({ first: 'al-1' });
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]?.providerIds).toEqual({ first: 't-1', second: 't-2' });
  });

  it('respects limit/offset on list sub-parts', async () => {
    const first = fakeMetadata('first');
    first.getArtist.mockResolvedValue(rawArtist({ provider: 'first', providerId: 'a-1' }));
    first.getArtistTracks.mockResolvedValue([
      rawTrack({ provider: 'first', providerId: 't-1', title: 'Song One' }),
      rawTrack({ provider: 'first', providerId: 't-2', title: 'Song Two' }),
    ]);
    const catalog = buildService([first]);

    const result = await catalog.getArtistDetail('a-1', { limit: 1, offset: 1 });

    expect(result.topTracks).toHaveLength(1);
    expect(result.topTracks[0]?.providerIds).toEqual({ first: 't-2' });
  });

  it('always yields NOT_FOUND for playlists until M3.2', async () => {
    const catalog = buildService([fakeMetadata('first')]);
    await expect(catalog.getPlaylistDetail('p-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('track source availability', () => {
  it('returns the resolved track with no sources when no source providers exist', async () => {
    const first = fakeMetadata('first');
    first.getTrack.mockResolvedValue(rawTrack({ provider: 'first', providerId: 'x-1' }));
    const catalog = buildService([first]);

    const result = await catalog.getTrackSources('x-1');

    expect(result.track.providerIds).toEqual({ first: 'x-1' });
    expect(result.sources).toEqual([]);
  });

  it('collects availability from every source provider', async () => {
    const first = fakeMetadata('first');
    first.getTrack.mockResolvedValue(
      rawTrack({ provider: 'first', providerId: 'x-1', isrc: 'USX' }),
    );
    const src = fakeSource('jamendo');
    const info: SourceInfo = {
      provider: 'jamendo',
      type: 'stream',
      url: 'https://cdn/1.mp3',
      format: 'mp3',
      availability: 'AVAILABLE',
    };
    src.checkAvailability.mockResolvedValue([info]);
    const catalog = buildService([first], [src]);

    const result = await catalog.getTrackSources('x-1');

    expect(result.sources).toEqual([info]);
    expect(src.checkAvailability).toHaveBeenCalledWith(expect.objectContaining({ isrc: 'USX' }));
    expect(result.providers).toEqual({
      attempted: ['first', 'jamendo'],
      succeeded: ['first', 'jamendo'],
      failed: [],
    });
  });

  it('isolates a failing source provider', async () => {
    const first = fakeMetadata('first');
    first.getTrack.mockResolvedValue(rawTrack({ provider: 'first', providerId: 'x-1' }));
    const broken = fakeSource('broken');
    broken.checkAvailability.mockRejectedValue(new Error('source down'));
    const catalog = buildService([first], [broken]);

    const result = await catalog.getTrackSources('x-1');

    expect(result.sources).toEqual([]);
    expect(result.providers.failed).toEqual([{ provider: 'broken', error: 'Error: source down' }]);
  });

  it('throws NOT_FOUND for an unknown track', async () => {
    const catalog = buildService([fakeMetadata('first')]);
    await expect(catalog.getTrackSources('unknown')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
