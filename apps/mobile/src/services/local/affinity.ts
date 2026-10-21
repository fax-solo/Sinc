/**
 * On-device listening-affinity scoring — the local personalization engine.
 *
 * Pure and deterministic: no network, no clock reads (time is injected), no
 * RNG. The same inputs always produce the same ranking, which is what makes
 * mixes stable across refreshes and unit-testable in Node.
 *
 * Signal hierarchy (strongest → weakest):
 *   1. full listens (completedCount)      × 0.9
 *   2. artist-level play counts           × 1.0
 *   3. track starts (playCounts)          × 0.7
 *   4. thumbs up / thumbs down            ± 2.0
 *   5. follows / favorites                + 1.0 / + 1.2 (mark "familiar")
 *   6. recency of the evidence            decays with a 14-day half-life
 *   7. skips                              − 0.5 each
 *
 * Hidden artists are excluded outright; hidden and heavily-skipped tracks
 * are filtered from candidate pools via blacklistedTrackIds().
 */
import type { CanonicalTrack } from '@sinc/shared';
import type { LibrarySignals } from './musicApi';

export const RECENCY_HALF_LIFE_DAYS = 14;
export const SKIP_BLACKLIST_THRESHOLD = 3;

const WEIGHT_ARTIST_PLAY = 1.0;
const WEIGHT_TRACK_PLAY = 0.7;
const WEIGHT_COMPLETION = 0.9;
const WEIGHT_THUMB = 2.0;
const WEIGHT_FOLLOW = 1.0;
const WEIGHT_FAVORITE = 1.2;
const WEIGHT_RECENT = 0.4;
const WEIGHT_SKIP = 0.5;
/** Neutral recency for evidence with no timestamp (follows, artist counts). */
const NEUTRAL_RECENCY = 0.5;

export interface AffinityEvidence {
  /** trackId -> primary artist name (from recently played / favorites / downloads). */
  trackArtists: Map<string, string>;
  /** followed artist display names (weakest "familiar" signal). */
  familiarArtistNames: string[];
  /** artists appearing in the listener's favorites (stronger than follows). */
  favoriteArtistNames?: string[];
  /** tracks from the session's recent plays (fresh, recency-dated evidence). */
  recentTracks?: CanonicalTrack[];
  /** track objects seen on device, for resolving thumb targets. */
  knownTracks: Map<string, CanonicalTrack>;
  nowMs: number;
}

export interface ArtistAffinity {
  name: string;
  /** log-dampened, recency-adjusted ranking score (≥ 0). */
  score: number;
  /** weighted listen evidence before log/recency shaping (can be negative). */
  evidence: number;
  /** 0..1; 1 = evidence from today. Unknown timing → NEUTRAL_RECENCY. */
  recency: number;
  familiar: boolean;
}

interface ArtistBucket {
  evidence: number;
  lastAtMs: number;
  familiar: boolean;
}

function bump(
  artists: Map<string, ArtistBucket>,
  name: string,
  delta: number,
  lastAtMs = 0,
  familiar = false
): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const bucket = artists.get(trimmed) ?? {
    evidence: 0,
    lastAtMs: 0,
    familiar: false,
  };
  bucket.evidence += delta;
  if (lastAtMs > bucket.lastAtMs) bucket.lastAtMs = lastAtMs;
  bucket.familiar = bucket.familiar || familiar;
  artists.set(trimmed, bucket);
}

function recencyFor(lastAtMs: number, nowMs: number): number {
  if (!lastAtMs) return NEUTRAL_RECENCY;
  const ageDays = Math.max(0, (nowMs - lastAtMs) / (24 * 60 * 60 * 1000));
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

export function computeArtistAffinity(
  signals: LibrarySignals | undefined,
  evidence: AffinityEvidence
): ArtistAffinity[] {
  const nowMs = evidence.nowMs;
  const buckets = new Map<string, ArtistBucket>();

  const resolveArtist = (trackId: string): string | undefined =>
    evidence.trackArtists.get(trackId) ?? evidence.knownTracks.get(trackId)?.artists[0]?.name;

  // 1) Artist-level play counts (the signal the old engine used exclusively).
  for (const p of signals?.artistPlayCounts ?? []) {
    bump(buckets, p.name, p.count * WEIGHT_ARTIST_PLAY);
  }

  // 2) Track-level evidence: starts + completions + recency timestamps.
  for (const pc of signals?.playCounts ?? []) {
    const artist = resolveArtist(pc.trackId);
    if (artist) bump(buckets, artist, pc.count * WEIGHT_TRACK_PLAY, pc.lastPlayedAt);
  }
  for (const cc of signals?.completedCounts ?? []) {
    const artist = resolveArtist(cc.trackId);
    if (artist) bump(buckets, artist, cc.count * WEIGHT_COMPLETION);
  }

  // 3) Thumbs (targetId may be a track id; artists resolve through known tracks).
  for (const t of signals?.thumbs ?? []) {
    const artist = resolveArtist(t.targetId);
    if (!artist) continue;
    bump(buckets, artist, t.value === 'up' ? WEIGHT_THUMB : -WEIGHT_THUMB);
  }

  // 4) Skips (mapped through known tracks).
  for (const s of signals?.skipCounts ?? []) {
    const artist = resolveArtist(s.trackId);
    if (artist) bump(buckets, artist, -s.count * WEIGHT_SKIP);
  }

  // 5) Follows are familiar by definition; favorites carry a stronger bump.
  for (const name of evidence.familiarArtistNames) {
    bump(buckets, name, WEIGHT_FOLLOW, 0, true);
  }
  for (const name of evidence.favoriteArtistNames ?? []) {
    bump(buckets, name, WEIGHT_FAVORITE, 0, true);
  }
  // 6) Session recency: threads of today's plays count as fresh evidence
  //    (they may be absent from playCounts until the next store flush).
  for (const t of evidence.recentTracks ?? []) {
    const artist = t.artists[0]?.name;
    if (artist) bump(buckets, artist, WEIGHT_RECENT, evidence.nowMs);
  }

  // 7) Rank and shape.
  const hiddenLower = new Set((signals?.hiddenArtistNames ?? []).map((h) => h.toLowerCase()));
  const result: ArtistAffinity[] = [];
  for (const [name, bucket] of buckets) {
    if (hiddenLower.has(name.toLowerCase())) continue;
    const recency = recencyFor(bucket.lastAtMs, nowMs);
    const adjusted = Math.max(0, bucket.evidence) * (0.4 + 0.6 * recency);
    const score = Math.log1p(adjusted);
    result.push({
      name,
      score,
      evidence: bucket.evidence,
      recency,
      familiar: bucket.familiar || bucket.evidence > 0,
    });
  }
  result.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return result;
}

/** True when the artist has real positive evidence worth building mixes from. */
export function hasUsefulAffinity(affinity: ArtistAffinity[] | undefined): boolean {
  return (affinity ?? []).some((a) => a.score > 0.08);
}

/** Track ids excluded from recommendation pools: hidden + heavily skipped. */
export function blacklistedTrackIds(signals: LibrarySignals | undefined): Set<string> {
  const blocked = new Set<string>(signals?.hiddenTrackIds ?? []);
  for (const s of signals?.skipCounts ?? []) {
    if (s.count >= SKIP_BLACKLIST_THRESHOLD) blocked.add(s.trackId);
  }
  return blocked;
}

// ---------------------------------------------------------------------------
// deterministic randomness (day-stable mixes)
// ---------------------------------------------------------------------------

const FNV_OFFSET = 0x811c9dc5;

/** FNV-1a: stable across sessions, produces a decent-quality 32-bit seed. */
export function hashString(value: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32 PRNG — small, fast, deterministic, and survives JSON round-trips. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** YYYY-MM-DD in local time; the unit of mix stability ("the day's mixes"). */
export function localDayKey(nowMs: number): string {
  const d = new Date(nowMs);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Fisher–Yates over a copy. Replaces the biased sort-by-random "shuffle". */
export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
