/**
 * Lyrics model: synced (LRC-style timed lines) with plain-text fallback.
 * Lyrics are independent of the audio source.
 */

export interface SyncedLyricLine {
  timeMs: number;
  text: string;
  endTimeMs?: number;
}

export interface LyricsResult {
  provider: string;
  isSynced: boolean;
  text?: string;
  syncedLines?: SyncedLyricLine[];
  language?: string;
  offsetMs?: number;
  matchConfidence?: number;
  license?: string;
  fetchedAt: string;
}

export interface LyricsCandidate {
  provider: string;
  externalId?: string;
  title: string;
  artistNames: string[];
  durationMs?: number;
  isrc?: string;
  version?: string;
  hasSynced: boolean;
}

export const MIN_LYRICS_CONFIDENCE = 0.6;

export interface LyricsCacheEntry {
  trackId: string;
  result: LyricsResult | null;
  fetchedAt: number;
  /** true = matched lyrics, false = known-miss (cache the miss). */
  matched: boolean;
}
