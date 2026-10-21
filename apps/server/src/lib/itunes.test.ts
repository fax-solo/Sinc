import { afterEach, describe, expect, it } from 'vitest';
import { ItunesAdapter } from './itunes.js';

const searchResponse = (results: unknown[]) => ({ resultCount: results.length, results });

const trackRow = {
  wrapperType: 'track',
  kind: 'song',
  trackId: 11,
  trackName: 'Song A',
  artistId: 9,
  artistName: 'Artist',
  collectionId: 44,
  collectionName: 'Big Album',
  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/100x100bb.jpg',
  trackNumber: 2,
  trackTimeMillis: 183000,
  trackExplicitness: 'explicit',
  releaseDate: '2020-01-01T00:00:00Z',
};

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: URL) => unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    return new Response(JSON.stringify(handler(url)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ItunesAdapter', () => {
  it('maps search results to canonical tracks with resized artwork', async () => {
    mockFetch(() => searchResponse([trackRow]));
    const adapter = new ItunesAdapter();
    const [track] = await adapter.searchTracks('Song A');
    expect(track).toMatchObject({
      id: 'itunes:11',
      title: 'Song A',
      artists: [{ id: 'itunes:9', name: 'Artist' }],
      album: { id: 'itunes:44', title: 'Big Album', type: 'album' },
      durationMs: 183000,
      trackNumber: 2,
      explicit: true,
      providerIds: { itunes: '11' },
      releaseDate: '2020-01-01T00:00:00Z',
    });
    expect(track.artworkUrl).toContain('/300x300bb.jpg');
  });

  it('classifies album types from the collection name', async () => {
    mockFetch((url) =>
      searchResponse(
        url.searchParams.get('term') === 'single'
          ? [{ ...trackRow, collectionName: 'My Single' }]
          : [{ ...trackRow, collectionName: 'Long EP' }]
      )
    );
    const adapter = new ItunesAdapter();
    const [single] = await adapter.searchAlbums('single');
    const [ep] = await adapter.searchAlbums('ep');
    expect(single.type).toBe('single');
    expect(ep.type).toBe('ep');
  });

  it('enriches artists with artwork via a batch lookup', async () => {
    let calls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls += 1;
      const url = new URL(String(input));
      if (url.pathname === '/search') {
        return new Response(
          JSON.stringify(
            searchResponse([
              { wrapperType: 'artist', artistId: 9, artistName: 'Artist', primaryGenreName: 'Pop' },
            ])
          ),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify(
          searchResponse([
            {
              wrapperType: 'collection',
              artistId: 9,
              collectionId: 44,
              collectionName: 'Big Album',
              artworkUrl100: 'https://x/100x100bb.jpg',
            },
          ])
        ),
        { status: 200 }
      );
    }) as typeof fetch;

    const adapter = new ItunesAdapter();
    const [artist] = await adapter.searchArtists('Artist');
    expect(artist.id).toBe('itunes:9');
    expect(artist.genres).toEqual(['Pop']);
    expect(artist.artworkUrl).toContain('/300x300bb.jpg');
    expect(calls).toBe(2);
  });

  it('keeps artists when artwork enrichment fails', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/search') {
        return new Response(
          JSON.stringify(
            searchResponse([{ wrapperType: 'artist', artistId: 9, artistName: 'Artist' }])
          ),
          { status: 200 }
        );
      }
      throw new Error('lookup down');
    }) as typeof fetch;

    const adapter = new ItunesAdapter();
    const [artist] = await adapter.searchArtists('Artist');
    expect(artist.artworkUrl).toBeUndefined();
  });

  it('backs playlists with album rows', async () => {
    mockFetch(() => searchResponse([{ ...trackRow, wrapperType: 'collection' }]));
    const adapter = new ItunesAdapter();
    const [playlist] = await adapter.searchPlaylists('Album');
    expect(playlist).toMatchObject({
      id: 'itunes:44',
      name: 'Big Album',
      owner: { id: 'itunes:9', name: 'Artist' },
      isCollaborative: false,
      providerIds: { itunes: '44' },
    });
  });

  it('returns null from lookupTrack when no song matches', async () => {
    mockFetch(() => searchResponse([{ wrapperType: 'collection' }]));
    const adapter = new ItunesAdapter();
    expect(await adapter.lookupTrack('999')).toBeNull();
  });

  it('lookupAlbum sorts tracks by disc then track number', async () => {
    mockFetch(() =>
      searchResponse([
        {
          ...trackRow,
          wrapperType: 'collection',
          collectionId: 44,
          collectionName: 'Big Album',
          trackCount: 2,
          trackNumber: undefined,
        },
        { ...trackRow, trackId: 2, trackName: 'B', discNumber: 1, trackNumber: 2 },
        { ...trackRow, trackId: 1, trackName: 'A', discNumber: 1, trackNumber: 1 },
      ])
    );
    const adapter = new ItunesAdapter();
    const result = await adapter.lookupAlbum('44');
    expect(result).not.toBeNull();
    expect(result!.album.trackCount).toBe(2);
    expect(result!.tracks.map((t) => t.title)).toEqual(['A', 'B']);
  });

  it('lookupAlbum returns null when the album row is missing', async () => {
    mockFetch(() => searchResponse([trackRow]));
    const adapter = new ItunesAdapter();
    expect(await adapter.lookupAlbum('44')).toBeNull();
  });

  it('lookupArtist maps albums and drops non-artist rows', async () => {
    mockFetch(() =>
      searchResponse([
        { wrapperType: 'artist', artistId: 9, artistName: 'Artist', primaryGenreName: 'Rock' },
        {
          wrapperType: 'collection',
          artistId: 9,
          collectionId: 12,
          collectionName: 'Thing',
          trackCount: 8,
        },
      ])
    );
    const adapter = new ItunesAdapter();
    const result = await adapter.lookupArtist('9');
    expect(result!.artist.name).toBe('Artist');
    expect(result!.albums).toHaveLength(1);
    expect(result!.topTracks).toEqual([]);
  });

  it('surfaces HTTP and network failures as provider errors', async () => {
    globalThis.fetch = (async () => new Response('oops', { status: 503 })) as typeof fetch;
    const adapter = new ItunesAdapter();
    await expect(adapter.searchTracks('x')).rejects.toMatchObject({
      code: 'ITUNES_ERROR',
      status: 502,
    });

    globalThis.fetch = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    await expect(adapter.searchTracks('x')).rejects.toMatchObject({
      code: 'ITUNES_TIMEOUT',
      status: 504,
    });
  });
});
