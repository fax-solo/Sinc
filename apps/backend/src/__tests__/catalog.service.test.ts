import { describe, it, expect, vi } from 'vitest';
import { CatalogService } from '../domain/catalog/catalog.service.js';
import type { MetadataProvider } from '../domain/catalog/types.js';
import { ProviderRegistryImpl } from '../domain/catalog/registry.js';

function stubProvider(
  id: string,
  tracks: Array<Record<string, unknown>> = [],
  fail = false,
): MetadataProvider {
  const search = fail
    ? vi.fn(async () => {
        throw new Error(`provider ${id} exploded`);
      })
    : vi.fn(async () => ({
        query: 'q',
        tracks,
        artists: [],
        albums: [],
      }));
  return {
    id,
    type: 'metadata',
    search,
    getTrack: vi.fn(async () => null),
    getArtist: vi.fn(async () => null),
    getAlbum: vi.fn(async () => null),
    getArtistTracks: vi.fn(async () => []),
    getArtistAlbums: vi.fn(async () => []),
    getAlbumTracks: vi.fn(async () => []),
    getRelatedArtists: vi.fn(async () => []),
    healthCheck: vi.fn(async () => ({ ok: true, checkedAt: new Date().toISOString() })),
  };
}

const track = (overrides: Record<string, unknown> = {}) => ({
  provider: 'musicbrainz',
  providerId: 'rec-1',
  title: 'Hotel California',
  artistNames: ['Eagles'],
  ...overrides,
});

function makeService(...providers: MetadataProvider[]) {
  const registry = new ProviderRegistryImpl();
  for (const provider of providers) registry.register(provider);
  return new CatalogService(registry);
}

describe('CatalogService.search', () => {
  it('fans out to every enabled provider and returns ranked results', async () => {
    const mb = stubProvider('musicbrainz', [track()]);
    const lastfm = stubProvider('lastfm', [
      track({ provider: 'lastfm', providerId: 'lf-1', title: 'Hotel California' }),
    ]);
    const service = makeService(mb, lastfm);

    const results = await service.search('Hotel California');
    expect(results.tracks).toHaveLength(1);
    expect(results.providers.attempted.sort()).toEqual(['lastfm', 'musicbrainz']);
    expect(results.providers.succeeded.sort()).toEqual(['lastfm', 'musicbrainz']);
    expect(results.providers.failed).toEqual([]);
    expect(results.tracks[0]?.track.title).toBe('Hotel California');
    expect(results.tracks[0]?.track.providerIds).toEqual({ musicbrainz: 'rec-1', lastfm: 'lf-1' });
  });

  it('deduplicates the same track reported by 5 providers into 1 result', async () => {
    const providers = ['a', 'b', 'c', 'd', 'e'].map((p) =>
      stubProvider(p, [track({ provider: p, providerId: `${p}-1`, isrc: 'USMC17638786' })]),
    );
    const service = makeService(...providers);
    const results = await service.search('Hotel California');
    expect(results.tracks).toHaveLength(1);
    expect(Object.keys(results.tracks[0]?.track.providerIds ?? {})).toHaveLength(5);
  });

  it('degrades gracefully when a provider fails', async () => {
    const good = stubProvider('musicbrainz', [track()]);
    const bad = stubProvider('lastfm', [], true);
    const service = makeService(good, bad);

    const results = await service.search('Hotel California');
    expect(results.tracks).toHaveLength(1);
    expect(results.providers.failed).toEqual([
      { provider: 'lastfm', error: expect.stringContaining('exploded') },
    ]);
  });

  it('returns empty results when every provider fails', async () => {
    const service = makeService(stubProvider('a', [], true), stubProvider('b', [], true));
    const results = await service.search('Hotel California');
    expect(results.tracks).toEqual([]);
    expect(results.providers.succeeded).toEqual([]);
  });

  it('does not call disabled providers', async () => {
    const registry = new ProviderRegistryImpl();
    const mb = stubProvider('musicbrainz', [track()]);
    const lastfm = stubProvider('lastfm', [track({ provider: 'lastfm', providerId: 'lf-1' })]);
    registry.register(mb);
    registry.register(lastfm);
    registry.setEnabled('lastfm', false);
    const service = new CatalogService(registry);

    const results = await service.search('Hotel California');
    expect(results.tracks[0]?.track.providerIds).toEqual({ musicbrainz: 'rec-1' });
    expect(lastfm.search).not.toHaveBeenCalled();
  });

  it('skips providers whose circuit is open', async () => {
    const registry = new ProviderRegistryImpl({ openThreshold: 1, halfOpenDelayMs: 60_000 });
    const bad = stubProvider('flaky', [], true);
    registry.register(bad);
    registry.register(stubProvider('musicbrainz', [track()]));
    const service = new CatalogService(registry);

    await service.search('Hotel California');
    await service.search('Hotel California');
    const third = await service.search('Hotel California');
    expect(third.providers.attempted).not.toContain('flaky');
  });

  it('ranks an exact match above a fuzzy one', async () => {
    const service = makeService(
      stubProvider('musicbrainz', [track({ providerId: 'exact' })]),
      stubProvider('lastfm', [
        track({ provider: 'lastfm', providerId: 'fuzzy', title: 'Hotel Califormia' }),
      ]),
    );
    const results = await service.search('Hotel California');
    expect(results.tracks[0]?.track.providerIds.musicbrainz).toBe('exact');
    expect(results.tracks[0]?.score.total).toBeGreaterThan(results.tracks[1]?.score.total ?? 0);
  });

  it('respects the result limit', async () => {
    const service = makeService(
      stubProvider('musicbrainz', [
        track({ providerId: '1', title: 'Hotel California' }),
        track({ providerId: '2', title: 'New Kid in Town' }),
        track({ providerId: '3', title: 'One of These Nights' }),
      ]),
    );
    const results = await service.search('Hotel California', { limit: 2 });
    expect(results.tracks).toHaveLength(2);
  });

  it('surfaces empty providers summary when no providers are registered', async () => {
    const service = makeService();
    const results = await service.search('anything');
    expect(results.tracks).toEqual([]);
    expect(results.providers.attempted).toEqual([]);
  });

  it('applies artist/album/duration filters to ranked tracks', async () => {
    const service = makeService(
      stubProvider('musicbrainz', [
        track({
          providerId: '1',
          title: 'Hotel California',
          artistNames: ['Eagles'],
          durationMs: 391000,
          albumTitle: 'Hotel California',
        }),
        track({
          providerId: '2',
          title: 'New Kid in Town',
          artistNames: ['Eagles'],
          durationMs: 318000,
          albumTitle: 'Hotel California',
        }),
        track({
          providerId: '3',
          title: 'Stairway to Heaven',
          artistNames: ['Led Zeppelin'],
          durationMs: 482000,
          albumTitle: 'IV',
        }),
      ]),
    );
    const artistFiltered = await service.search('california', { artist: 'Eagles' });
    expect(artistFiltered.tracks).toHaveLength(2);
    const albumFiltered = await service.search('california', { album: 'IV' });
    expect(albumFiltered.tracks).toHaveLength(1);
    expect(albumFiltered.tracks[0]?.track.title).toBe('Stairway to Heaven');
    const durationFiltered = await service.search('california', { durationMax: 400000 });
    expect(durationFiltered.tracks).toHaveLength(2);
    const durationRange = await service.search('california', {
      durationMin: 400000,
      durationMax: 500000,
    });
    expect(durationRange.tracks).toHaveLength(1);
  });

  it('returns no tracks when filters exclude everything', async () => {
    const service = makeService(stubProvider('musicbrainz', [track()]));
    const results = await service.search('hotel', { artist: 'Nobody' });
    expect(results.tracks).toEqual([]);
  });

  it('suggest maps songs/artists/albums and ranks exact matches first', async () => {
    const service = makeService(
      stubProvider('musicbrainz', [
        track({ providerId: 'exact', title: 'Hotel California', artistNames: ['Eagles'] }),
        track({ providerId: 'fuzzy', title: 'Hotel Californa', artistNames: ['Eagles'] }),
      ]),
    );
    const suggestions = await service.suggest('Hotel California');
    expect(suggestions[0]).toMatchObject({ type: 'song', text: 'Hotel California' });
    expect(suggestions.length).toBeLessThanOrEqual(8);
    expect(suggestions.every((s) => s.text && s.type)).toBe(true);
  });

  it('suggest respects the limit', async () => {
    const service = makeService(
      stubProvider('musicbrainz', [
        track({ providerId: '1', title: 'Hotel California' }),
        track({ providerId: '2', title: 'New Kid in Town' }),
        track({ providerId: '3', title: 'One of These Nights' }),
        track({ providerId: '4', title: 'Take It Easy' }),
        track({ providerId: '5', title: 'Witchy Woman' }),
      ]),
    );
    const suggestions = await service.suggest('hotel', 2);
    expect(suggestions).toHaveLength(2);
  });

  it('suggest returns empty for empty results', async () => {
    const service = makeService(stubProvider('musicbrainz', []));
    expect(await service.suggest('zzz')).toEqual([]);
  });
});
