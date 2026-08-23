import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack, TrackLyrics } from '@sinc/shared';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { SYNC_MAX_MS, useLyricsStore } from './lyricsStore';

const getLyrics = vi.fn();

vi.mock('../../api/music', () => ({
  musicApi: {
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
