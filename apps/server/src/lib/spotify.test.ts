import { describe, expect, it } from 'vitest';
import { parsePlaylistId, fetchPlaylistTracks } from './spotify.js';
import { AppError } from '@sinc/shared';

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
