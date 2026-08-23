import { describe, expect, it, vi } from 'vitest';
import { DeezerAdapter } from './deezer.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const trackPayload = {
  id: 12345,
  title: 'بلو بيري (قولي ازاى تقدري تنسي)',
  duration: 178,
  release_date: '2024-05-03',
  artist: { id: 7, name: 'otsha', picture_medium: 'https://img/artist.jpg' },
  album: {
    id: 88,
    title: 'بلو بيري',
    cover_medium: 'https://img/cover.jpg',
    release_date: '2024-05-03',
  },
};

describe('DeezerAdapter', () => {
  it('maps search results to CanonicalTrack with deezer ids', async () => {
    const adapter = new DeezerAdapter();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('api.deezer.com/search/track');
      return jsonResponse({ data: [trackPayload] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const tracks = await adapter.searchTracks('بلو بيرى');
    expect(tracks).toHaveLength(1);
    const t = tracks[0];
    expect(t.id).toBe('deezer:12345');
    expect(t.title).toBe(trackPayload.title);
    expect(t.artists[0].name).toBe('otsha');
    expect(t.artists[0].id).toBe('deezer:7');
    expect(t.providerIds).toEqual({ deezer: '12345' });
    expect(t.durationMs).toBe(178_000);
    expect(t.album?.title).toBe('بلو بيري');
    expect(t.album?.providerIds).toEqual({ deezer: '88' });
    expect(t.artworkUrl).toBe('https://img/cover.jpg');
    vi.unstubAllGlobals();
  });

  it('looks up a track by id', async () => {
    const adapter = new DeezerAdapter();
    const fetchMock = vi.fn(async () => jsonResponse(trackPayload));
    vi.stubGlobal('fetch', fetchMock);

    const track = await adapter.lookupTrack('12345');
    expect(track?.id).toBe('deezer:12345');
    expect(track?.durationMs).toBe(178_000);
    vi.unstubAllGlobals();
  });

  it('returns an empty list when the API reports an error', async () => {
    const adapter = new DeezerAdapter();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'Quota exceeded', code: 4 } })
    );
    vi.stubGlobal('fetch', fetchMock);

    const tracks = await adapter.searchTracks('x');
    expect(tracks).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('returns null when the track lookup misses', async () => {
    const adapter = new DeezerAdapter();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'not found', code: 800 } })
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await adapter.lookupTrack('missing')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('maps the global chart to tracks (Top 50)', async () => {
    const adapter = new DeezerAdapter();
    const fetchMock = vi.fn(async () => jsonResponse({ data: [trackPayload] }));
    vi.stubGlobal('fetch', fetchMock);

    const tracks = await adapter.chartTracks(50);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe('deezer:12345');
    vi.unstubAllGlobals();
  });

  it('maps chart albums with artist + artwork', async () => {
    const adapter = new DeezerAdapter();
    const albumPayload = {
      id: 88,
      title: 'بلو بيري',
      cover_medium: 'https://img/cover.jpg',
      nb_tracks: 10,
      release_date: '2024-05-03',
      artist: { id: 7, name: 'otsha' },
    };
    const fetchMock = vi.fn(async () => jsonResponse({ data: [albumPayload] }));
    vi.stubGlobal('fetch', fetchMock);

    const albums = await adapter.chartAlbums(25);
    expect(albums).toHaveLength(1);
    expect(albums[0].id).toBe('deezer:88');
    expect(albums[0].title).toBe('بلو بيري');
    expect(albums[0].artist.name).toBe('otsha');
    expect(albums[0].trackCount).toBe(10);
    expect(albums[0].artworkUrl).toBe('https://img/cover.jpg');
    vi.unstubAllGlobals();
  });

  it('maps chart artists', async () => {
    const adapter = new DeezerAdapter();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ id: 7, name: 'otsha', picture_medium: 'https://img/a.jpg' }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const artists = await adapter.chartArtists(10);
    expect(artists[0].id).toBe('deezer:7');
    expect(artists[0].name).toBe('otsha');
    expect(artists[0].artworkUrl).toBe('https://img/a.jpg');
    vi.unstubAllGlobals();
  });

  it('maps real top playlists', async () => {
    const adapter = new DeezerAdapter();
    const playlistPayload = {
      id: 999,
      title: 'Top Hits',
      description: 'The biggest hits',
      picture_medium: 'https://img/p.jpg',
      nb_tracks: 50,
      creator: { id: 42, name: 'Deezer' },
    };
    const fetchMock = vi.fn(async () => jsonResponse({ data: [playlistPayload] }));
    vi.stubGlobal('fetch', fetchMock);

    const playlists = await adapter.chartPlaylists(10);
    expect(playlists[0].id).toBe('deezer:999');
    expect(playlists[0].name).toBe('Top Hits');
    expect(playlists[0].owner.name).toBe('Deezer');
    expect(playlists[0].trackCount).toBe(50);
    expect(playlists[0].artworkUrl).toBe('https://img/p.jpg');
    vi.unstubAllGlobals();
  });

  it('resolves a playlist and its tracks', async () => {
    const adapter = new DeezerAdapter();
    const playlistPayload = {
      id: 999,
      title: 'Top Hits',
      picture_medium: 'https://img/p.jpg',
      creator: { id: 42, name: 'Deezer' },
      tracks: { data: [trackPayload] },
    };
    const fetchMock = vi.fn(async () => jsonResponse(playlistPayload));
    vi.stubGlobal('fetch', fetchMock);

    const result = await adapter.lookupPlaylist('999');
    expect(result?.playlist.id).toBe('deezer:999');
    expect(result?.tracks).toHaveLength(1);
    expect(result?.tracks[0].id).toBe('deezer:12345');
    vi.unstubAllGlobals();
  });

  it('returns null for a missing playlist', async () => {
    const adapter = new DeezerAdapter();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'not found', code: 800 } })
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await adapter.lookupPlaylist('missing')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('resolves an album and its tracks', async () => {
    const adapter = new DeezerAdapter();
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: 555,
        title: 'Blueberry',
        cover_medium: 'https://img/c.jpg',
        artist: { id: 7, name: 'otsha' },
        nb_tracks: 1,
        tracks: { data: [trackPayload] },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await adapter.lookupAlbum('555');
    expect(result?.album.id).toBe('deezer:555');
    expect(result?.album.artist.name).toBe('otsha');
    expect(result?.tracks[0].id).toBe('deezer:12345');
    vi.unstubAllGlobals();
  });

  it('resolves an artist with top tracks and albums', async () => {
    const adapter = new DeezerAdapter();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/top')) return jsonResponse({ data: [trackPayload] });
      if (url.includes('/albums')) {
        return jsonResponse({
          data: [{ id: 555, title: 'Blueberry', artist: { id: 7, name: 'otsha' } }],
        });
      }
      return jsonResponse({ id: 7, name: 'otsha', picture_medium: 'https://img/a.jpg' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await adapter.lookupArtist('7');
    expect(result?.artist.id).toBe('deezer:7');
    expect(result?.artist.artworkUrl).toBe('https://img/a.jpg');
    expect(result?.topTracks[0].id).toBe('deezer:12345');
    expect(result?.albums[0].id).toBe('deezer:555');
    vi.unstubAllGlobals();
  });

  it('returns null for a missing artist', async () => {
    const adapter = new DeezerAdapter();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'not found', code: 800 } })
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await adapter.lookupArtist('missing')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('fetches genre chart tracks and the genre id of an artist', async () => {
    const adapter = new DeezerAdapter();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/chart/')) return jsonResponse({ data: [trackPayload] });
      if (url.includes('/search/track'))
        return jsonResponse({ data: [{ ...trackPayload, genre_id: 196 }] });
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const chart = await adapter.genreChartTracks(196, 50);
    expect(chart[0].id).toBe('deezer:12345');

    const genreId = await adapter.genreForArtist('otsha');
    expect(genreId).toBe(196);
    vi.unstubAllGlobals();
  });

  it('returns null genre when the artist has no track hit', async () => {
    const adapter = new DeezerAdapter();
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await adapter.genreForArtist('nonexistent')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('resolves a genre name', async () => {
    const adapter = new DeezerAdapter();
    const fetchMock = vi.fn(async () => jsonResponse({ id: 196, name: 'Pop Arabe' }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await adapter.genreName(196)).toBe('Pop Arabe');
    vi.unstubAllGlobals();
  });
});
