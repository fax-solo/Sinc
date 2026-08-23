import { describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { LrclibProvider } from './lyrics.js';

function makeTrack(overrides: Partial<CanonicalTrack> = {}): CanonicalTrack {
  return {
    id: 'track-1',
    title: 'bloodline',
    artists: [{ id: 'a1', name: 'Ariana Grande', providerIds: {}, genres: [] }],
    durationMs: 216_000,
    explicit: false,
    providerIds: {},
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('LrclibProvider fallback chain', () => {
  it('returns the exact match from /api/get', async () => {
    const provider = new LrclibProvider();
    const fetchMock = vi.fn(async () => {
      return jsonResponse({ syncedLyrics: '[00:01.00]exact', plainLyrics: null, language: 'en' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const raw = await provider.fetchLyrics(makeTrack());
    expect(raw?.synced).toContain('exact');
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('retries /api/get without duration when the exact lookup misses', async () => {
    const provider = new LrclibProvider();
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return url.includes('duration=')
        ? jsonResponse({}, 404)
        : jsonResponse({ syncedLyrics: '[00:01.00]nodur', plainLyrics: null, language: 'en' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const raw = await provider.fetchLyrics(makeTrack());
    expect(raw?.synced).toContain('nodur');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('duration=');
    expect(calls[1]).not.toContain('duration=');
    vi.unstubAllGlobals();
  });

  it('falls back to search and picks the closest variant-aware candidate', async () => {
    const provider = new LrclibProvider();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/get')) return jsonResponse({}, 404);
      return jsonResponse([
        {
          id: 1,
          trackName: 'Bloodline (Sped Up)',
          artistName: 'Ariana Grande',
          duration: 140,
          syncedLyrics: '[00:00.00]bad',
          plainLyrics: null,
        },
        {
          id: 2,
          trackName: 'bloodline',
          artistName: 'Ariana Grande',
          duration: 218,
          syncedLyrics: '[00:01.00]good',
          plainLyrics: null,
          language: 'en',
        },
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const raw = await provider.fetchLyrics(makeTrack({ durationMs: 216_000 }));
    expect(raw?.synced).toContain('good');
    vi.unstubAllGlobals();
  });

  it('returns null when nothing matches', async () => {
    const provider = new LrclibProvider();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/get')) return jsonResponse({}, 404);
      return jsonResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const raw = await provider.fetchLyrics(makeTrack());
    expect(raw).toBeNull();
    vi.unstubAllGlobals();
  });
});
