import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack, TrackLyrics } from '@sinc/shared';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { SYNC_MAX_MS, useLyricsStore } from './lyricsStore';

const getLyrics = vi.fn();

vi.mock('../providers/lrclib', () => ({
  lrclib: {
    getLyrics: (...args: unknown[]) => getLyrics(...args),
  },
}));

function track(id: string): CanonicalTrack {
  return {
    id,
    title: 'Lyric Track',
    artists: [{ id: `a-${id}`, name: 'Artist', providerIds: {}, genres: [] }],
    durationMs: 1000,
    providerIds: { itunes: id },
    explicit: false,
  };
}

const synced: TrackLyrics = {
  trackId: 'itunes:1',
  provider: 'lrclib',
  synced: true,
  language: 'en',
  lines: [
    { timeMs: 0, text: 'First' },
    { timeMs: 1000, text: 'Second' },
  ],
};

beforeEach(() => {
  storage.remove(STORAGE_KEYS.LYRICS);
  storage.remove(STORAGE_KEYS.LYRICS_OFFSETS);
  storage.remove(STORAGE_KEYS.LYRICS_MISSES);
  useLyricsStore.setState({ cache: {}, loading: {}, offsets: {} });
  vi.clearAllMocks();
});

describe('lyricsStore', () => {
  it('returns null before any lyrics are loaded', () => {
    expect(useLyricsStore.getState().getCached('itunes:1')).toBeNull();
  });

  it('fetches and caches lyrics', async () => {
    getLyrics.mockResolvedValue(synced);
    const result = await useLyricsStore.getState().loadLyrics(track('itunes:1'));

    expect(getLyrics).toHaveBeenCalledWith('itunes:1', track('itunes:1'));
    expect(result?.synced).toBe(true);
    expect(useLyricsStore.getState().getCached('itunes:1')?.lines).toHaveLength(2);
  });

  it('serves cached lyrics without hitting the network again', async () => {
    getLyrics.mockResolvedValue(synced);
    await useLyricsStore.getState().loadLyrics(track('itunes:1'));
    vi.clearAllMocks();

    const again = await useLyricsStore.getState().loadLyrics(track('itunes:1'));
    expect(again?.trackId).toBe('itunes:1');
    expect(getLyrics).not.toHaveBeenCalled();
  });

  it('persists lyrics to storage so they survive restarts (offline)', async () => {
    getLyrics.mockResolvedValue(synced);
    await useLyricsStore.getState().loadLyrics(track('itunes:1'));

    const fromDisk = storage.getObject<Record<string, TrackLyrics>>(STORAGE_KEYS.LYRICS);
    expect(fromDisk?.['itunes:1']).toBeTruthy();
    expect(fromDisk?.['itunes:1'].lines[1].text).toBe('Second');
  });

  it('returns null when the network fails', async () => {
    getLyrics.mockRejectedValue(new Error('offline'));
    const result = await useLyricsStore.getState().loadLyrics(track('itunes:1'));
    expect(result).toBeNull();
    expect(useLyricsStore.getState().getCached('itunes:1')).toBeNull();
  });

  it('retries a failed track immediately (transport failure is not a miss)', async () => {
    // A weak-network moment must not poison the 7-day negative cache.
    getLyrics.mockRejectedValue(new Error('offline'));
    await useLyricsStore.getState().loadLyrics(track('itunes:1'));

    getLyrics.mockResolvedValue(synced);
    const second = await useLyricsStore.getState().loadLyrics(track('itunes:1'));
    expect(second?.synced).toBe(true);
    expect(getLyrics).toHaveBeenCalledTimes(2);
    const misses = storage.getObject<Record<string, number>>(STORAGE_KEYS.LYRICS_MISSES) ?? {};
    expect(misses['itunes:1']).toBeUndefined();
  });

  it('warmLyrics fetches only tracks that actually need lyrics', async () => {
    getLyrics.mockResolvedValue(synced);
    // Track 1: already cached successfully.
    await useLyricsStore.getState().loadLyrics(track('itunes:1'));
    // Track 9: recently missed → negative cache must suppress it.
    getLyrics.mockResolvedValue({
      trackId: 'itunes:9',
      provider: 'none',
      synced: false,
      lines: [],
      language: null,
    });
    await useLyricsStore.getState().loadLyrics(track('itunes:9'));
    vi.clearAllMocks();

    getLyrics.mockResolvedValue(synced);
    await useLyricsStore.getState().warmLyrics([
      track('itunes:1'), // cached → skip
      track('itunes:9'), // fresh miss → skip
      track('itunes:2'), // missing → fetch
      track('itunes:3'), // maxAhead=2 default spans 2 → fetched too
      track('itunes:4'), // beyond the window → skipped
    ]);

    expect(getLyrics).toHaveBeenCalledTimes(2);
    const cached = useLyricsStore.getState().cache;
    expect(cached['itunes:2']).toBeTruthy();
    expect(cached['itunes:3']).toBeTruthy();
    expect(cached['itunes:4']).toBeUndefined();
  });

  it('warmLyrics respects the maxAhead window', async () => {
    getLyrics.mockResolvedValue(synced);
    await useLyricsStore
      .getState()
      .warmLyrics([track('itunes:1'), track('itunes:2'), track('itunes:3')], 1);
    expect(getLyrics).toHaveBeenCalledTimes(1);
    expect(useLyricsStore.getState().cache['itunes:2']).toBeUndefined();
  });
  it('warmLyrics survives provider failures without aborting the sweep', async () => {
    getLyrics.mockRejectedValueOnce(new Error('offline'));
    getLyrics.mockResolvedValue(synced);
    await useLyricsStore.getState().warmLyrics([track('itunes:1'), track('itunes:2')]);
    expect(getLyrics).toHaveBeenCalledTimes(2);
    expect(useLyricsStore.getState().cache['itunes:2']).toBeTruthy();
  });

  it('does not refetch a fresh miss (negative cache)', async () => {
    getLyrics.mockResolvedValue({
      trackId: 'itunes:9',
      provider: 'none',
      synced: false,
      lines: [],
      language: null,
    });
    await useLyricsStore.getState().loadLyrics(track('itunes:9'));
    vi.clearAllMocks();

    const again = await useLyricsStore.getState().loadLyrics(track('itunes:9'));
    expect(again?.lines).toHaveLength(0);
    expect(getLyrics).not.toHaveBeenCalled();
  });

  it('retries a miss after the TTL expires', async () => {
    getLyrics.mockResolvedValue({
      trackId: 'itunes:9',
      provider: 'none',
      synced: false,
      lines: [],
      language: null,
    });
    await useLyricsStore.getState().loadLyrics(track('itunes:9'));

    const misses = storage.getObject<Record<string, number>>(STORAGE_KEYS.LYRICS_MISSES) ?? {};
    storage.setObject(STORAGE_KEYS.LYRICS_MISSES, {
      ...misses,
      'itunes:9': Date.now() - 8 * 24 * 60 * 60 * 1000,
    });
    vi.clearAllMocks();

    await useLyricsStore.getState().loadLyrics(track('itunes:9'));
    expect(getLyrics).toHaveBeenCalledTimes(1);
  });

  it('clears a track lyrics entry', async () => {
    getLyrics.mockResolvedValue(synced);
    await useLyricsStore.getState().loadLyrics(track('itunes:1'));
    useLyricsStore.getState().clearLyrics('itunes:1');
    expect(useLyricsStore.getState().getCached('itunes:1')).toBeNull();
  });

  it('starts with a zero sync offset', () => {
    expect(useLyricsStore.getState().getOffset('itunes:1')).toBe(0);
  });

  it('adjusts and clamps the per-track sync offset', () => {
    useLyricsStore.getState().adjustSync('itunes:1', 250);
    expect(useLyricsStore.getState().getOffset('itunes:1')).toBe(250);
    useLyricsStore.getState().adjustSync('itunes:1', -500);
    expect(useLyricsStore.getState().getOffset('itunes:1')).toBe(-250);
    useLyricsStore.getState().adjustSync('itunes:1', SYNC_MAX_MS * 10);
    expect(useLyricsStore.getState().getOffset('itunes:1')).toBe(SYNC_MAX_MS);
  });

  it('keeps offsets per track', () => {
    useLyricsStore.getState().adjustSync('itunes:1', 250);
    expect(useLyricsStore.getState().getOffset('itunes:2')).toBe(0);
  });

  it('persists offsets and resets them', () => {
    useLyricsStore.getState().adjustSync('itunes:1', 500);
    const fromDisk = storage.getObject<Record<string, number>>(STORAGE_KEYS.LYRICS_OFFSETS);
    expect(fromDisk?.['itunes:1']).toBe(500);

    useLyricsStore.getState().resetSync('itunes:1');
    expect(useLyricsStore.getState().getOffset('itunes:1')).toBe(0);
    expect(useLyricsStore.getState().offsets['itunes:1']).toBeUndefined();
  });
});
