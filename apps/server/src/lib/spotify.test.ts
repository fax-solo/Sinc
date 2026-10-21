import { describe, expect, it, beforeEach } from 'vitest';
import {
  parsePlaylistId,
  fetchPlaylistTracks,
  extractNextDataScript,
  resetSpotifyCache,
} from './spotify.js';
import { AppError } from '@sinc/shared';

describe('spotify extractNextDataScript', () => {
  it('extracts the JSON payload in the canonical layout', () => {
    const html = `<html><script id="__NEXT_DATA__" type="application/json">{"a":1}</script></html>`;
    expect(extractNextDataScript(html)).toBe('{"a":1}');
  });

  it('tolerates attribute order and extra attributes', () => {
    const html = `<html><script type="application/json" id="__NEXT_DATA__" data-testid="next">{"b":2}</script></html>`;
    expect(extractNextDataScript(html)).toBe('{"b":2}');
  });

  it('tolerates multi-line documents where the script tag is terminated before the JSON ends', () => {
    const html = `<html>\n<script id="__NEXT_DATA__" type="application/json">\n{"c":"\\u003C/script>"}\n</script>\n</html>`;
    expect(extractNextDataScript(html)).toBe('\n{"c":"\\u003C/script>"}\n');
  });

  it('returns null when the script tag is absent', () => {
    expect(extractNextDataScript('<html>no next data</html>')).toBeNull();
  });
});

describe('spotify parsePlaylistId', () => {
  const ID = '37i9dQZF1DWXRqgorJj26U';

  it('accepts open.spotify.com playlist URLs with query strings', () => {
    expect(parsePlaylistId(`https://open.spotify.com/playlist/${ID}?si=abc123`)).toBe(ID);
  });

  it('accepts bare URLs and spotify:playlist URIs', () => {
    expect(parsePlaylistId(`open.spotify.com/playlist/${ID}`)).toBe(ID);
    expect(parsePlaylistId(`spotify:playlist:${ID}`)).toBe(ID);
  });

  it('accepts embed URLs', () => {
    expect(parsePlaylistId(`https://open.spotify.com/embed/playlist/${ID}`)).toBe(ID);
  });

  it('rejects non-playlist links and garbage', () => {
    expect(parsePlaylistId('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toBeNull();
    expect(parsePlaylistId('not a link')).toBeNull();
    expect(parsePlaylistId('')).toBeNull();
  });
});

describe('spotify fetchPlaylistTracks', () => {
  beforeEach(() => {
    resetSpotifyCache();
  });
  it('retries a transient 5xx pathfinder response once before succeeding', async () => {
    const originalFetch = globalThis.fetch;
    let pathfinderCalls = 0;

    const trackItem = (i: number) => ({
      itemV2: {
        data: {
          __typename: 'Track',
          uri: `spotify:track:track${i}`,
          name: `Song ${i}`,
          trackDuration: { totalMilliseconds: 200000 + i },
          artists: { items: [{ profile: { name: 'Artist' } }] },
        },
      },
    });

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/embed/track/')) {
        return new Response(
          `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
            props: {
              pageProps: {
                state: {
                  settings: {
                    session: {
                      accessToken: 'anon-token-123',
                      accessTokenExpirationTimestampMs: Date.now() + 3_600_000,
                    },
                  },
                },
              },
            },
          })}</script></html>`,
          { status: 200 }
        );
      }
      pathfinderCalls += 1;
      if (pathfinderCalls === 1) {
        return new Response('server exploded', { status: 500 });
      }
      return new Response(
        JSON.stringify({
          data: {
            playlistV2: {
              name: 'Retried Playlist',
              ownerV2: { data: { name: 'Spotify' } },
              images: { items: [{ sources: [{ url: 'https://art.example/r.jpg' }] }] },
              content: { totalCount: 1, items: [trackItem(1)] },
            },
          },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    try {
      const playlist = await fetchPlaylistTracks('37i9dQZF1DWXRqgorjJ26U');
      expect(pathfinderCalls).toBe(2);
      expect(playlist.name).toBe('Retried Playlist');
      expect(playlist.tracks).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('re-bootstraps after a transient bootstrap network failure', async () => {
    const originalFetch = globalThis.fetch;
    let bootstrapCalls = 0;

    const trackItem = (i: number) => ({
      itemV2: {
        data: {
          __typename: 'Track',
          uri: `spotify:track:track${i}`,
          name: `Song ${i}`,
          trackDuration: { totalMilliseconds: 200000 + i },
          artists: { items: [{ profile: { name: 'Artist' } }] },
        },
      },
    });

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/embed/track/')) {
        bootstrapCalls += 1;
        if (bootstrapCalls === 1) throw new Error('network blip');
        return new Response(
          `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
            props: {
              pageProps: {
                state: {
                  settings: {
                    session: {
                      accessToken: 'anon-token-999',
                      accessTokenExpirationTimestampMs: Date.now() + 3_600_000,
                    },
                  },
                },
              },
            },
          })}</script></html>`,
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            playlistV2: {
              name: 'Recovered Playlist',
              ownerV2: { data: { name: 'Spotify' } },
              images: { items: [{ sources: [{ url: 'https://art.example/r.jpg' }] }] },
              content: { totalCount: 1, items: [trackItem(1)] },
            },
          },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    try {
      const playlist = await fetchPlaylistTracks('37i9dQZF1DWXRqgorjJ26U');
      expect(bootstrapCalls).toBe(2);
      expect(playlist.name).toBe('Recovered Playlist');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws AppError when the embed page is unreachable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    try {
      await expect(fetchPlaylistTracks('invalid-id-0000000000000000')).rejects.toBeInstanceOf(
        AppError
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('pages through the pathfinder GraphQL endpoint past the 100-track embed cap', async () => {
    const originalFetch = globalThis.fetch;

    const trackItem = (i: number) => ({
      itemV2: {
        data: {
          __typename: 'Track',
          uri: `spotify:track:track${i}`,
          name: `Song ${i}`,
          trackDuration: { totalMilliseconds: 200000 + i },
          artists: { items: [{ profile: { name: 'Artist' } }] },
        },
      },
    });

    const total = 101;
    const pageOf = (offset: number) =>
      Array.from({ length: Math.min(100, total - offset) }, (_, k) => trackItem(offset + k + 1));

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/embed/track/')) {
        return new Response(
          `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
            props: {
              pageProps: {
                state: {
                  settings: {
                    session: {
                      accessToken: 'anon-token-123',
                      accessTokenExpirationTimestampMs: Date.now() + 3_600_000,
                      isAnonymous: true,
                    },
                  },
                },
              },
            },
          })}</script></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        );
      }
      const offsetMatch = url.match(/offset%22%3A(\d+)/);
      const offset = offsetMatch ? Number(offsetMatch[1]) : 0;
      const items = pageOf(offset);
      return new Response(
        JSON.stringify({
          data: {
            playlistV2: {
              uri: 'spotify:playlist:37i9dQZF1DWXRqgorJj26U',
              name: 'Big Playlist',
              ownerV2: { data: { name: 'Spotify' } },
              images: { items: [{ sources: [{ url: 'https://art.example/x.jpg' }] }] },
              content: { totalCount: total, items },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    try {
      const playlist = await fetchPlaylistTracks('37i9dQZF1DWXRqgorJj26U');
      expect(playlist.name).toBe('Big Playlist');
      expect(playlist.owner).toBe('Spotify');
      expect(playlist.totalCount).toBe(101);
      expect(playlist.truncated).toBe(false);
      expect(playlist.artworkUrl).toBe('https://art.example/x.jpg');
      expect(playlist.tracks).toHaveLength(101);
      expect(playlist.tracks[100]).toMatchObject({
        uri: 'spotify:track:track101',
        title: 'Song 101',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to the 100-cap embed page when pathfinder fails', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/embed/track/')) {
        return new Response(
          `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
            props: {
              pageProps: {
                state: {
                  settings: {
                    session: {
                      accessToken: 'anon-token-123',
                      accessTokenExpirationTimestampMs: Date.now() + 3_600_000,
                      isAnonymous: true,
                    },
                  },
                },
              },
            },
          })}</script></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        );
      }
      if (url.includes('/pathfinder/')) {
        return new Response(JSON.stringify({ errors: [{ message: 'PersistedQueryNotFound' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Playlist embed fallback.
      return new Response(
        `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
          props: {
            pageProps: {
              state: {
                data: {
                  entity: {
                    name: 'Fallback Playlist',
                    subtitle: 'Owner',
                    coverArt: { sources: [{ url: 'https://art.example/y.jpg' }] },
                    trackList: [
                      { uri: 'spotify:track:a', title: 'One', subtitle: 'A', duration: 200000 },
                    ],
                  },
                },
              },
            },
          },
        })}</script></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    }) as typeof fetch;

    try {
      const playlist = await fetchPlaylistTracks('37i9dQZF1DWXRqgorJj26U');
      expect(playlist.name).toBe('Fallback Playlist');
      expect(playlist.truncated).toBe(true);
      expect(playlist.tracks).toHaveLength(1);
      expect(playlist.tracks[0]).toMatchObject({ title: 'One', artists: ['A'] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
