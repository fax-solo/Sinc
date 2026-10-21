import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractNextDataScript, importSpotifyPlaylist, musicApi, parsePlaylistId } from './music';

const { fetchMock, ytMock } = vi.hoisted(() => {
  const fetchMock = vi.fn();
  const ytMock = {
    available: vi.fn(() => true),
    resolveStream: vi.fn(async () => ({
      uri: 'https://s.example/a.m4a',
      ext: 'm4a',
      durationMs: 180000,
    })),
    resolveByQuery: vi.fn(
      async (_a: string, _b: string, _c: number | null) => null as string | null
    ),
    download: vi.fn(async () => null),
  };
  return { fetchMock, ytMock };
});

vi.mock('../services/native', () => ({
  nativeBridge: {
    player: { available: () => false },
    downloader: { available: () => false },
    downloads: {
      available: () => false,
      addActionListener: () => () => {},
      addYtProgressListener: () => () => {},
    },
    yt: ytMock,
  },
}));

function json(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  };
}

function track(provider: string, id: number, title: string, artist: string, durationMs = 200000) {
  return {
    id: `${provider}:${id}`,
    title,
    artists: [
      {
        id: `${provider}:${id}`,
        name: artist,
        providerIds: { [provider]: String(id) },
        genres: [],
      },
    ],
    album: {
      id: `${provider}:${id}`,
      title: 'Album',
      artist: { id: `${provider}:${id}`, name: artist, providerIds: {}, genres: [] },
      trackCount: 1,
      providerIds: {},
      type: 'album' as const,
    },
    durationMs,
    artworkUrl: undefined,
    providerIds: { [provider]: String(id) },
    explicit: false,
  };
}

const itunesTrack = (id: number, title: string, artist: string) => ({
  trackId: id,
  trackName: title,
  artistId: id,
  artistName: artist,
  collectionId: id,
  collectionName: 'Album',
  trackTimeMillis: 200000,
  artworkUrl100: 'https://cdn/100x100bb.jpg',
  trackExplicitness: 'notExplicit',
  wrapperType: 'track',
  kind: 'song',
});

const deezerTrack = (id: number, title: string, artist: string) => ({
  id,
  title,
  duration: 200,
  artist: { id, name: artist },
  album: { id, title: 'Album', cover_medium: 'https://cdn/med.jpg' },
});

beforeEach(() => {
  fetchMock.mockReset();
  ytMock.resolveStream.mockClear();
  ytMock.resolveByQuery.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Route = { payload?: unknown; status?: number; text?: string } | undefined;

function stubFetch(handler: (url: string) => Route) {
  globalThis.fetch = fetchMock;
  fetchMock.mockImplementation(async (url: string) => {
    const hit = handler(url);
    if (hit === undefined) return json({ error: 'not found' }, 404);
    if (hit.text !== undefined) return json(hit.text, hit.status ?? 200);
    return json(hit.payload ?? {}, hit.status ?? 200);
  });
}

describe('musicApi (local)', () => {
  it('searches tracks from iTunes + Deezer, dedupes and scores', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://itunes.apple.com/search')) {
        return { payload: { results: [itunesTrack(1, 'Blade Runner', 'Vangelis')] } };
      }
      if (url.startsWith('https://api.deezer.com/search/track')) {
        return {
          payload: {
            data: [deezerTrack(2, 'Blade Runner', 'Vangelis'), deezerTrack(3, 'Other', 'Someone')],
          },
        };
      }
      return undefined;
    });

    const results = await musicApi.search('blade');
    expect(results.tracks?.data.map((r) => r.track.title)).toContain('Blade Runner');
    // exact-ish title + artist match outranks the mere-substring result
    const scores = results.tracks!.data.map((r) => r.score);
    expect(scores[0]).toBeGreaterThan(scores[scores.length - 1]);
  });

  it('searches artists from iTunes only', async () => {
    stubFetch((url) =>
      url.startsWith('https://itunes.apple.com/search')
        ? {
            payload: {
              results: [
                {
                  artistId: 1,
                  artistName: 'Vangelis',
                  primaryGenreName: 'Electronic',
                  wrapperType: 'artist',
                },
              ],
            },
          }
        : undefined
    );
    const results = await musicApi.search('vangelis', 'artists');
    expect(results.artists?.data[0].name).toBe('Vangelis');
    expect(results.tracks?.data ?? []).toHaveLength(0);
  });

  it('builds the home feed from Deezer charts', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://api.deezer.com/chart/0/tracks'))
        // A REAL-sized global chart (the day-rotation mood "Trending" also
        // resolves to chart 0). The old 2-track stub only worked on days
        // whose rotated moods excluded Trending: with a thin chart the
        // supplement search drops below the 5-track mix floor and the day
        // served 3 mixes instead of 4.
        return {
          payload: {
            data: [
              deezerTrack(7, 'Trend', 'ChartStar'),
              deezerTrack(8, 'Second', 'ChartStar'),
              ...Array.from({ length: 14 }, (_, i) =>
                deezerTrack(700 + i, `Global Hit ${i + 1}`, `GA${i % 5}`)
              ),
            ],
          },
        };
      if (url.startsWith('https://api.deezer.com/chart/0/albums'))
        return {
          payload: {
            data: [
              {
                id: 5,
                title: 'New Album',
                artist: { id: 9, name: 'A9' },
                cover_medium: 'x',
                nb_tracks: 3,
              },
            ],
          },
        };
      if (url.startsWith('https://api.deezer.com/chart/0/playlists'))
        return { payload: { data: [{ id: 6, title: 'Charts', nb_tracks: 20 }] } };
      if (url.startsWith('https://api.deezer.com/chart/0/artists'))
        return { payload: { data: [{ id: 9, name: 'A9', picture_medium: 'x' }] } };
      if (url.startsWith('https://api.deezer.com/chart/')) {
        const id = Number(url.split('/chart/')[1].split('/')[0]);
        const data = Array.from({ length: 6 }, (_, i) =>
          deezerTrack(id * 100 + 100 + i, `Genre${id} T${i}`, `GA${i}`)
        );
        return { payload: { data } };
      }
      if (url.startsWith('https://api.deezer.com/search/track'))
        return { payload: { data: [deezerTrack(300, 'Supplement', 'Sup')] } };
      return undefined;
    });

    const feed = await musicApi.getHomeFeed();
    expect(feed.popularTracks.map((t) => t.title)).toContain('Trend');
    expect(feed.newAlbums[0].title).toBe('New Album');
    expect(feed.topPlaylists[0].name).toBe('Charts');
    expect(feed.topArtists[0].name).toBe('A9');
    expect(feed.starterMixes).toHaveLength(4);
  });

  it('falls back to iTunes keyword searches when a chart is empty', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://api.deezer.com/chart/0/tracks')) return { payload: { data: [] } };
      if (url.startsWith('https://api.deezer.com/chart/0/albums')) return { payload: { data: [] } };
      if (url.startsWith('https://api.deezer.com/chart/0/playlists'))
        return { payload: { data: [] } };
      if (url.startsWith('https://api.deezer.com/chart/0/artists'))
        return { payload: { data: [] } };
      if (url.startsWith('https://itunes.apple.com/search')) {
        const term = decodeURIComponent(url.match(/term=([^&]+)/)?.[1] ?? '');
        if (term === 'trending music')
          return { payload: { results: [itunesTrack(1, 'Fallback Song', 'FB')] } };
        return { payload: { results: [] } };
      }
      if (url.startsWith('https://api.deezer.com/chart/')) {
        return { payload: { data: [deezerTrack(1, 'M1', 'G'), deezerTrack(2, 'M2', 'G')] } };
      }
      if (url.startsWith('https://api.deezer.com/search/track')) return { payload: { data: [] } };
      return undefined;
    });

    const feed = await musicApi.getHomeFeed();
    expect(feed.popularTracks[0].title).toBe('Fallback Song');
  });

  it('looks up a Deezer album and playlist', async () => {
    stubFetch((url) => {
      if (/api\.deezer\.com\/album\/5/.test(url))
        return {
          payload: {
            id: 5,
            title: 'New Album',
            artist: { id: 9, name: 'A9' },
            cover_medium: 'x',
            tracks: { data: [deezerTrack(11, 'Song 1', 'A9')] },
          },
        };
      if (/api\.deezer\.com\/playlist\/6/.test(url))
        return {
          payload: {
            id: 6,
            title: 'Charts',
            nb_tracks: 1,
            tracks: { data: [deezerTrack(11, 'Song 1', 'A9')] },
          },
        };
      return undefined;
    });

    const album = await musicApi.getAlbum('deezer:5');
    expect(album.tracks[0].title).toBe('Song 1');

    const playlist = await musicApi.getPlaylist('deezer:6');
    expect(playlist.playlist.name).toBe('Charts');
    expect(playlist.tracks[0].title).toBe('Song 1');
  });

  it('resolves playback for a known soundcloud source via the native yt module', async () => {
    const t = track('youtube', 1, 'Breathe', 'Nouvelle');
    t.providerIds.soundcloud = 'https://soundcloud.com/x/breathe';
    ytMock.resolveStream.mockResolvedValueOnce({
      uri: 'https://s.example/audio.m4a',
      ext: 'm4a',
      durationMs: 210000,
    });
    const source = await musicApi.resolvePlaybackForTrack(t);
    expect(ytMock.resolveStream).toHaveBeenCalledWith('https://soundcloud.com/x/breathe');
    expect(source.uri).toBe('https://s.example/audio.m4a');
    expect(source.provider).toBe('soundcloud');
    expect(source.mimeType).toBe('audio/mp4');
  });

  it('resolves playback by query when no direct source exists', async () => {
    const t = track('itunes', 1, 'Blade', 'Vangelis');
    ytMock.resolveByQuery.mockResolvedValueOnce('https://youtube.com/watch?v=abc');
    ytMock.resolveStream.mockResolvedValueOnce({
      uri: 'https://s.example/x.mp3',
      ext: 'mp3',
      durationMs: 200000,
    });
    const source = await musicApi.resolvePlaybackForTrack(t);
    expect(ytMock.resolveByQuery).toHaveBeenCalledWith('Vangelis', 'Blade', 200000);
    expect(source.mimeType).toBe('audio/mpeg');
    expect(source.provider).toBe('youtube');
  });

  it('fetches synced lyrics from LRCLIB and parses them', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://lrclib.net/api/get'))
        return {
          payload: { syncedLyrics: '[00:00.00]First\n[00:01.00]Second', language: 'en' },
        };
      return undefined;
    });
    const lyrics = await musicApi.getLyrics('itunes:1', track('itunes', 1, 'Blade', 'Vangelis'));
    expect(lyrics.synced).toBe(true);
    expect(lyrics.lines).toHaveLength(2);
    expect(lyrics.lines[1].text).toBe('Second');
    expect(lyrics.provider).toBe('lrclib');
  });

  it('returns local personalized sections even with no listening signal', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://api.deezer.com/chart/0/artists'))
        return { payload: { data: [] } };
      if (url.startsWith('https://api.deezer.com/chart/0/tracks'))
        return { payload: { data: [deezerTrack(1, 'T1', 'G')] } };
      if (url.startsWith('https://api.deezer.com/chart/0/playlists'))
        return { payload: { data: [] } };
      if (url.startsWith('https://api.deezer.com/search/track'))
        return { payload: { data: [deezerTrack(2, 'T2', 'G')] } };
      if (url.startsWith('https://api.deezer.com/chart/'))
        return { payload: { data: [deezerTrack(9, 'M', 'G')] } };
      return undefined;
    });

    const feed = await musicApi.getPersonalizedHomeFeed({
      playlists: [],
      recentlyPlayedPlaylistIds: [],
      downloadedTracks: [],
      followedArtists: [],
      followedAlbums: [],
    });
    expect(feed.personalized).toBe(false);
    expect(Array.isArray(feed.sections)).toBe(true);
  });
});

describe('musicApi spotify import', () => {
  const nextDataHtml = (payload: unknown, attrOrder: 'idFirst' | 'typeFirst' = 'typeFirst') => {
    const tag =
      attrOrder === 'idFirst'
        ? '<script id="__NEXT_DATA__" type="application/json">'
        : '<script type="application/json" id="__NEXT_DATA__">';
    return `<!doctype html><html><body>${tag}${JSON.stringify(payload)}</script></body></html>`;
  };

  const bootstrapBody = {
    props: {
      pageProps: {
        state: {
          settings: { session: { accessToken: 'anon-token-123' } },
        },
      },
    },
  };

  const pathfinderPlaylist = (items: unknown[]) => ({
    data: {
      playlistV2: {
        name: 'My Jams',
        ownerV2: { data: { name: 'Solo' } },
        images: { items: [{ sources: [{ url: 'https://i.scdn.co/art/cover' }] }] },
        content: { totalCount: items.length, items },
      },
    },
  });

  const rawTrack = (uri: string, title: string, artist: string, durationMs: number) => ({
    itemV2: {
      data: {
        __typename: 'Track',
        uri,
        name: title,
        trackDuration: { totalMilliseconds: durationMs },
        artists: { items: [{ profile: { name: artist } }] },
      },
    },
  });

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('parses a pathfinder page (itemV2.data + artists.items) and matches against iTunes', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://open.spotify.com/embed/track/'))
        return { text: nextDataHtml(bootstrapBody, 'idFirst') };
      if (url.startsWith('https://itunes.apple.com/search')) {
        const term = decodeURIComponent(url.match(/term=([^&]+)/)?.[1] ?? '');
        if (term.includes('Blade Runner'))
          return { payload: { results: [itunesTrack(1, 'Blade Runner', 'Vangelis')] } };
        return { payload: { results: [] } };
      }
      if (url.startsWith('https://api.deezer.com/search/track')) return { payload: { data: [] } };
      if (url.startsWith('https://api-partner.spotify.com/pathfinder/v1/query'))
        return {
          payload: pathfinderPlaylist([
            rawTrack('spotify:track:AAA', 'Blade Runner', 'Vangelis', 213456),
          ]),
        };
      return undefined;
    });

    const result = await importSpotifyPlaylist(
      'https://open.spotify.com/playlist/5LKsK4MZgQyNLmZBzPdUce'
    );
    expect(result.playlist.name).toBe('My Jams');
    expect(result.playlist.owner).toBe('Solo');
    expect(result.playlist.artworkUrl).toBe('https://i.scdn.co/art/cover');
    expect(result.playlist.truncated).toBe(false);
    expect(result.tracks[0].title).toBe('Blade Runner');
    expect(result.tracks[0].providerIds.itunes).toBe('1');
    expect(result.counts).toEqual({ fetched: 1, matched: 1, unresolved: 0, duplicates: 0 });
  });

  it('accepts a spotify: URI and dedupes identical title/artist pairs', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://open.spotify.com/embed/track/'))
        return { text: nextDataHtml(bootstrapBody) };
      if (url.startsWith('https://itunes.apple.com/search')) return { payload: { results: [] } };
      if (url.startsWith('https://api.deezer.com/search/track')) return { payload: { data: [] } };
      if (url.startsWith('https://api-partner.spotify.com/pathfinder/v1/query')) {
        const vars = JSON.parse(
          decodeURIComponent(url.match(/[?&]variables=([^&]+)/)?.[1] ?? '{}')
        ) as { offset?: number };
        const offset = vars.offset ?? 0;
        return {
          payload: pathfinderPlaylist(
            offset === 0
              ? [
                  rawTrack('spotify:track:AAA', 'Blade Runner', 'Vangelis', 213456),
                  rawTrack('spotify:track:BBB', 'Blade Runner', 'Vangelis', 213456),
                ]
              : []
          ),
        };
      }
      return undefined;
    });

    const result = await importSpotifyPlaylist('spotify:playlist:5LKsK4MZgQyNLmZBzPdUce');
    expect(result.playlist.id).toBe('spotify:playlist:5LKsK4MZgQyNLmZBzPdUce');
    expect(result.tracks).toHaveLength(1);
    expect(result.counts.fetched).toBe(1);
    expect(result.counts.duplicates).toBe(1);
  });

  it('degrades to the public embed page when pathfinder fails', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://open.spotify.com/embed/track/'))
        return { text: nextDataHtml(bootstrapBody) };
      if (url.startsWith('https://open.spotify.com/embed/playlist/'))
        return {
          text: nextDataHtml({
            props: {
              pageProps: {
                state: {
                  data: {
                    entity: {
                      name: 'Embed Picks',
                      subtitle: 'Embed Owner',
                      coverArt: { sources: [{ url: 'https://i.scdn.co/art/embed' }] },
                      trackList: [
                        {
                          uri: 'spotify:track:CCC',
                          title: 'Afterglow',
                          subtitle: 'Artist A, Artist B',
                          duration: 180000,
                        },
                      ],
                    },
                  },
                },
              },
            },
          }),
        };
      if (url.startsWith('https://itunes.apple.com/search')) return { payload: { results: [] } };
      if (url.startsWith('https://api.deezer.com/search/track')) return { payload: { data: [] } };
      return undefined;
    });

    const result = await importSpotifyPlaylist(
      'https://open.spotify.com/playlist/5LKsK4MZgQyNLmZBzPdUce'
    );
    expect(result.playlist.name).toBe('Embed Picks');
    expect(result.playlist.owner).toBe('Embed Owner');
    expect(result.tracks[0].title).toBe('Afterglow');
    expect(result.tracks[0].artists.map((a) => a.name)).toEqual(['Artist A', 'Artist B']);
    expect(result.tracks[0].providerIds.spotify).toBe('CCC');
    expect(result.playlist.truncated).toBe(false);
  });

  it('extracts __NEXT_DATA__ regardless of script attribute order', () => {
    const html =
      '<html><script data-x type="application/json" id="__NEXT_DATA__">{"a":1}</script></html>';
    expect(extractNextDataScript(html)).toBe('{"a":1}');
    expect(extractNextDataScript('<html><script>nope</script></html>')).toBeNull();
  });

  it('parses spotify playlist ids from links, uris and embeds', () => {
    expect(parsePlaylistId('https://open.spotify.com/playlist/5LKsK4MZgQyNLmZBzPdUce')).toBe(
      '5LKsK4MZgQyNLmZBzPdUce'
    );
    expect(parsePlaylistId('https://open.spotify.com/embed/playlist/5LKsK4MZgQyNLmZBzPdUce')).toBe(
      '5LKsK4MZgQyNLmZBzPdUce'
    );
    expect(parsePlaylistId('spotify:playlist:5LKsK4MZgQyNLmZBzPdUce')).toBe(
      '5LKsK4MZgQyNLmZBzPdUce'
    );
    expect(parsePlaylistId('   ')).toBeNull();
    expect(parsePlaylistId('https://example.com/not-a-playlist')).toBeNull();
  });
});
