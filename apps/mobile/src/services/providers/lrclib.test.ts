import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { LyricsUnreachableError, lrclib } from './lrclib';

type FetchMock = ReturnType<typeof vi.fn>;

function respond(item: unknown) {
  return makeJson(item);
}

function makeJson(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (status >= 400) throw new Error(`HTTP ${status}`);
      return body;
    },
  };
}

function track(): CanonicalTrack {
  return {
    id: 'itunes:1',
    title: 'Neon Sky (feat. Bird)',
    artists: [
      { id: 'a1', name: 'Luna', providerIds: {}, genres: [] },
      { id: 'a2', name: 'Kai', providerIds: {}, genres: [] },
    ],
    durationMs: 214_000,
    artworkUrl: undefined,
    providerIds: { itunes: '1' },
    explicit: false,
  };
}

describe('lrclib ladder', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a synced hit from the exact get without extra steps', async () => {
    fetchMock.mockResolvedValueOnce(
      respond({
        trackName: 'Neon Sky',
        artistName: 'Luna',
        syncedLyrics: '[01:00.00]hi',
        language: 'en',
      })
    );
    const lyrics = await lrclib.getLyrics('t1', track());
    expect(lyrics.synced).toBe(true);
    expect(lyrics.lines[0]?.text).toBe('hi');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls through to the qualifier-stripped search when the raw fields miss', async () => {
    // get x2 -> 404, search(raw) -> empty, search(stripped) -> hit
    fetchMock
      .mockResolvedValueOnce(makeJson({ message: 'not found' }, 404))
      .mockResolvedValueOnce(makeJson({ message: 'not found' }, 404))
      .mockResolvedValueOnce(respond([]))
      .mockResolvedValueOnce(
        respond([
          {
            trackName: 'Neon Sky',
            artistName: 'Luna, Kai',
            plainLyrics: 'plain text',
            duration: 214,
          },
        ])
      );
    const lyrics = await lrclib.getLyrics('t1', track());
    expect(lyrics.provider).toBe('lrclib');
    expect(lyrics.plain).toBe('plain text');
    const strippedUrl = String(fetchMock.mock.calls[3][0]);
    expect(strippedUrl).toContain('track_name=' + encodeURIComponent('Neon Sky'));
    expect(strippedUrl).toContain(encodeURIComponent('Luna'));
    // only the primary artist, not the joined collab string
    expect(strippedUrl).not.toContain(encodeURIComponent('Luna, Kai'));
  });

  it('uses the full-text q= fallback for renamed masters', async () => {
    // get x2 -> 404, search(raw) -> empty, search(stripped) -> empty, q= -> hit
    fetchMock
      .mockResolvedValueOnce(makeJson({ message: 'not found' }, 404))
      .mockResolvedValueOnce(makeJson({ message: 'not found' }, 404))
      .mockResolvedValueOnce(respond([]))
      .mockResolvedValueOnce(respond([]))
      .mockResolvedValueOnce(
        respond([{ trackName: 'Neon Sky', artistName: 'Luna', plainLyrics: 'found it' }])
      );
    const lyrics = await lrclib.getLyrics('t1', track());
    expect(lyrics.plain).toBe('found it');
    const wideUrl = String(fetchMock.mock.calls[4][0]);
    expect(wideUrl).toContain('/api/search?q=');
  });

  it('skips the wide steps when the ladder failed at transport level', async () => {
    // get x2 -> dead, search(raw) -> dead → no authoritative absence seen.
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error('timeout')))
      .mockRejectedValueOnce(Object.assign(new Error('timeout')))
      .mockRejectedValueOnce(Object.assign(new Error('timeout')));
    await expect(lrclib.getLyrics('t1', track())).rejects.toBeInstanceOf(LyricsUnreachableError);
    // No step 4/5 probes were stacked on top of the dead network.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports an authoritative miss when every answering probe came back empty', async () => {
    fetchMock
      .mockResolvedValueOnce(makeJson({ message: 'not found' }, 404))
      .mockResolvedValueOnce(makeJson({ message: 'not found' }, 404))
      .mockResolvedValueOnce(respond([]))
      .mockResolvedValueOnce(respond([]));
    const lyrics = await lrclib.getLyrics('t1', track());
    expect(lyrics.provider).toBe('none');
  });

  it('defaults to the plain-lyrics hit when synced is missing', async () => {
    // get x2 -> 404, search(raw) -> hits but instrumental/lyrics-less,
    // stripped search -> real lyric hit.
    fetchMock
      .mockResolvedValueOnce(makeJson({ message: 'not found' }, 404))
      .mockResolvedValueOnce(makeJson({ message: 'not found' }, 404))
      .mockResolvedValueOnce(
        respond([{ trackName: 'Neon Sky', artistName: 'Luna', plainLyrics: null }])
      )
      .mockResolvedValueOnce(
        respond([{ trackName: 'Neon Sky', artistName: 'Luna, Kai', plainLyrics: 'words' }])
      );
    const lyrics = await lrclib.getLyrics('t1', track());
    expect(lyrics.plain).toBe('words');
  });

  it('accepts Arabic titles spelled with the opposite twin letters', async () => {
    // The catalog spells 'المرشدى' with alef maqsura; LRCLIB's entry spells
    // 'المرشدي' with yeh. They are the SAME song — before the fold this
    // scored under the bar and the ladder reported an authoritative miss.
    const arTrack: CanonicalTrack = {
      ...track(),
      title: 'الولا حمو جه',
      artists: [{ id: 'a1', name: 'حمو المرشدى', providerIds: {}, genres: [] }],
      durationMs: 203_000,
    };
    fetchMock
      .mockResolvedValueOnce(makeJson({ message: 'not found' }, 404))
      .mockResolvedValueOnce(makeJson({ message: 'not found' }, 404))
      .mockResolvedValueOnce(
        respond([
          {
            trackName: 'الولا حمو جه',
            artistName: 'حمو المرشدي',
            plainLyrics: 'كلمات',
            duration: 203,
          },
        ])
      );
    const lyrics = await lrclib.getLyrics('t1', arTrack);
    expect(lyrics.provider).toBe('lrclib');
    expect(lyrics.plain).toBe('كلمات');
  });
});
