import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MusicBrainzMetadataProvider } from '../domain/catalog/providers/musicbrainz/index.js';
import { MusicBrainzHttp } from '../domain/catalog/providers/musicbrainz/http.js';
import {
  mbAlbumSearch,
  mbArtistLookup,
  mbArtistRecordings,
  mbArtistReleaseGroups,
  mbArtistSearch,
  mbRecordingLookup,
  mbRecordingSearch,
  mbRelatedArtists,
  mbReleaseGroupLookup,
  mbReleaseLookup,
} from './fixtures/musicbrainz.js';

/** Stub fetch that serves a canned response per URL substring. */
function mockFetch(routes: Record<string, unknown>): typeof fetch {
  const fn = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    for (const [needle, body] of Object.entries(routes)) {
      if (url.includes(needle)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ error: `no route for ${url}` }), { status: 404 });
  });
  return fn as unknown as typeof fetch;
}

function makeProvider(routes: Record<string, unknown>) {
  const http = new MusicBrainzHttp(mockFetch(routes));
  return new MusicBrainzMetadataProvider(http, 0);
}

describe('MusicBrainzMetadataProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('search maps recordings, artists and albums from JSON', async () => {
    const provider = makeProvider({
      '/recording': mbRecordingSearch,
      '/artist?': mbArtistSearch,
      '/release-group?': mbAlbumSearch,
    });
    const results = await provider.search('Hotel California');
    expect(results.tracks).toHaveLength(1);
    expect(results.tracks[0]).toMatchObject({
      provider: 'musicbrainz',
      title: 'Hotel California (Remix)',
      artistNames: ['Eagles'],
      albumTitle: 'Hotel California',
      durationMs: 391000,
      isrc: 'USMC17638786',
      releaseDate: '1976-12-08',
      popularity: 100,
    });
    expect(results.artists).toHaveLength(2);
    expect(results.artists[0]?.nameVariants).toEqual(['American rock band']);
    expect(results.albums).toHaveLength(1);
    expect(results.albums[0]).toMatchObject({
      title: 'Hotel California',
      type: 'ALBUM',
      releaseDate: '1976-12-08',
      totalTracks: 9,
    });
  });

  it('search sends a MusicBrainz-compliant User-Agent', async () => {
    const fn = vi.fn(async () => new Response(JSON.stringify({ recordings: [] }), { status: 200 }));
    const http = new MusicBrainzHttp(fn as unknown as typeof fetch);
    const provider = new MusicBrainzMetadataProvider(http, 0);
    await provider.search('test');
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('Sinc/0.1');
  });

  it('search deduplicates identical provider results from parallel fan-out', async () => {
    const provider = makeProvider({
      '/recording': { recordings: [mbRecordingSearch.recordings[0]] },
      '/artist?': mbArtistSearch,
      '/release-group?': mbAlbumSearch,
    });
    const results = await provider.search('Hotel California');
    expect(results.tracks).toHaveLength(1);
  });

  it('getTrack returns null-mapped recording', async () => {
    const provider = makeProvider({ '/recording/rec-1': mbRecordingLookup });
    const track = await provider.getTrack('rec-1');
    expect(track?.title).toBe('Hotel California');
    expect(track?.isrc).toBe('USMC17638786');
  });

  it('getArtist maps genres from genres and tags', async () => {
    const provider = makeProvider({ '/artist/art-1?': mbArtistLookup });
    const artist = await provider.getArtist('art-1');
    expect(artist?.name).toBe('Eagles');
    expect(artist?.genres).toEqual(['classic rock', 'rock']);
  });

  it('getAlbum maps a release-group with total tracks', async () => {
    const provider = makeProvider({ '/release-group/rg-1?': mbReleaseGroupLookup });
    const album = await provider.getAlbum('rg-1');
    expect(album?.totalTracks).toBe(2);
    expect(album?.type).toBe('ALBUM');
  });

  it('getArtistTracks returns recordings', async () => {
    const provider = makeProvider({ '/artist/art-1/recordings': mbArtistRecordings });
    const tracks = await provider.getArtistTracks('art-1');
    expect(tracks.map((t) => t.title)).toEqual(['Hotel California', 'New Kid in Town']);
  });

  it('getArtistAlbums returns release-groups', async () => {
    const provider = makeProvider({ '/artist/art-1/release-groups': mbArtistReleaseGroups });
    const albums = await provider.getArtistAlbums('art-1');
    expect(albums).toHaveLength(1);
    expect(albums[0]?.title).toBe('Hotel California');
  });

  it('getAlbumTracks resolves the official release and maps its media', async () => {
    const provider = makeProvider({
      '/release-group/rg-1?': mbReleaseGroupLookup,
      '/release/rel-': mbReleaseLookup,
    });
    const tracks = await provider.getAlbumTracks('rg-1');
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      title: 'Hotel California',
      artistNames: ['Eagles'],
      albumTitle: 'Hotel California',
      trackNumber: 1,
      isrc: 'USMC17638786',
    });
  });

  it('getRelatedArtists keeps only artist relations', async () => {
    const provider = makeProvider({ '/artist/art-1?': mbRelatedArtists });
    const artists = await provider.getRelatedArtists('art-1');
    expect(artists).toHaveLength(1);
    expect(artists[0]?.name).toBe('The Doobie Brothers');
  });

  it('getAlbumTracks returns empty when no releases exist', async () => {
    const provider = makeProvider({
      '/release-group/rg-2?': { id: 'rg-2', title: 'Empty', 'release-list': [] },
    });
    expect(await provider.getAlbumTracks('rg-2')).toEqual([]);
  });

  it('healthCheck reports ok on success and error on failure', async () => {
    const ok = makeProvider({ '/artist?': { artists: [] } });
    expect((await ok.healthCheck()).ok).toBe(true);

    const fn = vi.fn(async () => new Response('', { status: 503 }));
    const http = new MusicBrainzHttp(
      fn as unknown as typeof fetch,
      'https://mb.example',
      'Sinc/0.1',
    );
    const failing = new MusicBrainzMetadataProvider(http, 0);
    const result = await failing.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/503/);
  });

  it('retries 5xx responses once then surfaces the failure', async () => {
    const fn = vi.fn(async () => new Response('', { status: 503 }));
    const http = new MusicBrainzHttp(
      fn as unknown as typeof fetch,
      'https://mb.example',
      'Sinc/0.1',
    );
    const provider = new MusicBrainzMetadataProvider(http, 0);
    await expect(provider.getTrack('rec-x')).rejects.toThrow(/503/);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('surfaces provider errors for unknown ids', async () => {
    const fn = vi.fn(async () => new Response('', { status: 404 }));
    const http = new MusicBrainzHttp(
      fn as unknown as typeof fetch,
      'https://mb.example',
      'Sinc/0.1',
    );
    const provider = new MusicBrainzMetadataProvider(http, 0);
    await expect(provider.getTrack('missing')).rejects.toThrow(/404/);
  });
});
