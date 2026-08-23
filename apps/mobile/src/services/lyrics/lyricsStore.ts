/**
 * Lyrics store. Caches resolved lyrics in MMKV (`sinc.lyrics`) so they are
 * available offline. Downloads warm the cache when a track is fetched, and the
 * lyrics screen falls back to the cache before hitting the network. Per-track
 * sync offsets let the user nudge lyric timing to match the audio.
 */
import { create } from 'zustand';
import type { CanonicalTrack, TrackLyrics } from '@sinc/shared';
import { musicApi } from '../../api/music';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { track as trackAnalytics } from '../analytics/analytics';

export const SYNC_STEP_MS = 250;
export const SYNC_MAX_MS = 5000;

interface LyricsState {
  cache: Record<string, TrackLyrics>;
  loading: Record<string, boolean>;
  /** Per-track timestamp shift in ms applied on top of the audio position. */
  offsets: Record<string, number>;
  getCached: (trackId: string) => TrackLyrics | null;
  getOffset: (trackId: string) => number;
  loadLyrics: (track: CanonicalTrack) => Promise<TrackLyrics | null>;
  clearLyrics: (trackId: string) => void;
  adjustSync: (trackId: string, deltaMs: number) => void;
  resetSync: (trackId: string) => void;
}

function readCache(): Record<string, TrackLyrics> {
  return storage.getObject<Record<string, TrackLyrics>>(STORAGE_KEYS.LYRICS) ?? {};
}

function readOffsets(): Record<string, number> {
  return storage.getObject<Record<string, number>>(STORAGE_KEYS.LYRICS_OFFSETS) ?? {};
}

function persistOffsets(offsets: Record<string, number>): void {
  storage.setObject(STORAGE_KEYS.LYRICS_OFFSETS, offsets);
}

export const useLyricsStore = create<LyricsState>()((set, get) => ({
  cache: readCache(),
  loading: {},
  offsets: readOffsets(),

  getCached: (trackId) => get().cache[trackId] ?? null,

  getOffset: (trackId) => get().offsets[trackId] ?? 0,

  loadLyrics: async (track) => {
    const existing = get().cache[track.id];
    if (existing && existing.lines.length > 0) return existing;
    if (get().loading[track.id]) return null;

    set({ loading: { ...get().loading, [track.id]: true } });
    try {
      const lyrics = await musicApi.getLyrics(track.id, track);
      if (lyrics.lines.length > 0) {
        trackAnalytics('lyrics:matched', track.id, { synced: lyrics.synced });
      }
      const nextCache = { ...get().cache, [track.id]: lyrics };
      set({ cache: nextCache });
      storage.setObject(STORAGE_KEYS.LYRICS, nextCache);
      return lyrics;
    } catch {
      return null;
    } finally {
      set({ loading: { ...get().loading, [track.id]: false } });
    }
  },

  clearLyrics: (trackId) => {
    const nextCache = { ...get().cache };
    delete nextCache[trackId];
    set({ cache: nextCache });
    storage.setObject(STORAGE_KEYS.LYRICS, nextCache);
  },

  adjustSync: (trackId, deltaMs) => {
    const current = get().offsets[trackId] ?? 0;
    const next = Math.max(-SYNC_MAX_MS, Math.min(SYNC_MAX_MS, current + deltaMs));
    const offsets = { ...get().offsets };
    if (next === 0) delete offsets[trackId];
    else offsets[trackId] = next;
    set({ offsets });
    persistOffsets(offsets);
  },

  resetSync: (trackId) => {
    const offsets = { ...get().offsets };
    delete offsets[trackId];
    set({ offsets });
    persistOffsets(offsets);
  },
}));
