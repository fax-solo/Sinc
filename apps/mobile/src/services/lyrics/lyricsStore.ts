/**
 * Lyrics store. Caches resolved lyrics in MMKV (`sinc.lyrics`) so they are
 * available offline. Playback, queued tracks and completed downloads warm
 * the cache eagerly, and the lyrics screen falls back to the cache before
 * hitting the network. Per-track sync offsets let the user nudge lyric
 * timing to match the audio.
 */
import { create } from 'zustand';
import type { CanonicalTrack, TrackLyrics } from '@sinc/shared';
import { lrclib } from '../providers/lrclib';
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
  /** Resolves (and caches) lyrics for a track, skipping fresh misses. */
  loadLyrics: (track: CanonicalTrack) => Promise<TrackLyrics | null>;
  /**
   * Sequences low-priority warm-ups (queue-ahead) so several future tracks
   * never flood a weak link at once; skips anything already cached/served.
   */
  warmLyrics: (tracks: CanonicalTrack[], maxAhead?: number) => Promise<void>;
  /** Drops a cached entry (also clears the negative-cache stamp). */
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

/**
 * Negative cache: when a track has no lyrics anywhere, refetching on every
 * screen open just hammers the network for the same empty answer. Remember
 * when the miss happened and skip the network until the TTL expires, so the
 * catalog gets a chance to gain lyrics later.
 */
export const LYRICS_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Upper bound on cached entries; oldest track ids are evicted past this. */
export const LYRICS_CACHE_MAX = 400;

function readMisses(): Record<string, number> {
  return storage.getObject<Record<string, number>>(STORAGE_KEYS.LYRICS_MISSES) ?? {};
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
    if (existing && existing.lines.length === 0) {
      const missedAt = readMisses()[track.id] ?? 0;
      if (Date.now() - missedAt < LYRICS_MISS_TTL_MS) return existing;
    }
    if (get().loading[track.id]) return null;

    set({ loading: { ...get().loading, [track.id]: true } });
    try {
      const lyrics = await lrclib.getLyrics(track.id, track);
      const grown = { ...get().cache, [track.id]: lyrics };
      // Bound the blob: evict oldest ids past the cap so one JSON write
      // never grows without limit.
      const keys = Object.keys(grown);
      const nextCache =
        keys.length > LYRICS_CACHE_MAX
          ? Object.fromEntries(keys.slice(keys.length - LYRICS_CACHE_MAX).map((k) => [k, grown[k]]))
          : grown;
      set({ cache: nextCache });
      storage.setObject(STORAGE_KEYS.LYRICS, nextCache);
      const misses = readMisses();
      if (lyrics.lines.length > 0) {
        trackAnalytics('lyrics:matched', track.id, { synced: lyrics.synced });
        if (misses[track.id] !== undefined) {
          delete misses[track.id];
          storage.setObject(STORAGE_KEYS.LYRICS_MISSES, misses);
        }
      } else {
        // Genuine "no lyrics exist" — the provider only reports this when
        // LRCLIB itself answered, so stamping the week-long negative cache
        // here is safe. Transport failures throw instead of reaching this
        // branch, so a weak-network blip never silences a track for 7 days.
        misses[track.id] = Date.now();
        storage.setObject(STORAGE_KEYS.LYRICS_MISSES, misses);
        trackAnalytics('lyrics:missed', track.id);
      }
      return lyrics;
    } catch {
      return null;
    } finally {
      set({ loading: { ...get().loading, [track.id]: false } });
    }
  },

  warmLyrics: async (tracks, maxAhead = 2) => {
    let warmed = 0;
    for (let index = 0; index < tracks.length && warmed < Math.max(0, maxAhead); index += 1) {
      const next = tracks[index];
      const state = get();
      const existing = state.cache[next.id];
      if (existing && (existing.lines.length > 0 || existing.plain)) continue;
      if (existing && existing.lines.length === 0) {
        const missedAt = readMisses()[next.id] ?? 0;
        if (Date.now() - missedAt < LYRICS_MISS_TTL_MS) continue;
      }
      if (state.loading[next.id]) continue;
      // Sequential on purpose: several future tracks must not flood a weak
      // link (or the stream itself, which shares the same bandwidth) at once.
      await state.loadLyrics(next);
      warmed += 1;
    }
  },

  clearLyrics: (trackId) => {
    const nextCache = { ...get().cache };
    delete nextCache[trackId];
    set({ cache: nextCache });
    storage.setObject(STORAGE_KEYS.LYRICS, nextCache);
    const misses = readMisses();
    if (misses[trackId] !== undefined) {
      delete misses[trackId];
      storage.setObject(STORAGE_KEYS.LYRICS_MISSES, misses);
    }
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
