/**
 * Pure mix-selection helpers — the deterministic core of "Made for you".
 *
 * Everything here is testable in Node and free of network calls. `musicApi.ts`
 * supplies the candidates; this module decides which ones make the mix, so
 * selection quality and diversity are verifiable independently of provider
 * flakiness.
 *
 * Determinism note: daily mixes used to be re-randomized on every fetch
 * (`() => Math.random()`), so "Made for you" reshuffled mid-browse and two
 * launches in the same hour produced unrelated mixes. Selection is now
 * driven by a day-keyed seed: stable within a day, rotates by day.
 */
import type { CanonicalTrack } from '@sinc/shared';

export const MIX_SIZE = 30;
/** Max tracks per lead artist in one mix (Spotify keeps mixes varied this way). */
export const MAX_PER_ARTIST = 3;

function similarityOfTokens(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let inter = 0;
  const bSet = new Set(b);
  const union = new Set([...a, ...b]);
  for (const tok of a) if (bSet.has(tok)) inter += 1;
  return union.size > 0 ? inter / union.size : 0;
}

export function trackSimilarity(a: CanonicalTrack, b: CanonicalTrack): number {
  const aArtist = a.artists[0]?.name ?? '';
  const bArtist = b.artists[0]?.name ?? '';
  let sim = 0;
  if (aArtist && aArtist === bArtist) sim += 0.6;
  if (a.album?.title && a.album.title === b.album?.title) sim += 0.25;
  const aTok = a.title.toLowerCase().split(/\W+/).filter(Boolean);
  const bTok = b.title.toLowerCase().split(/\W+/).filter(Boolean);
  sim += similarityOfTokens(aTok, bTok) * 0.15;
  return sim;
}

/**
 * MMR selection with an artist cap. `scoreOf` drives affinity ranking;
 * similarity spreads out same-artist/same-album tracks; ties are broken by
 * pool order, so callers shuffle the pool with the day seed first.
 */
export function selectMixTracks(
  pool: CanonicalTrack[],
  size: number,
  scoreOf: (track: CanonicalTrack) => number,
  maxPerArtist = MAX_PER_ARTIST
): CanonicalTrack[] {
  if (pool.length === 0 || size <= 0) return [];
  const scores = pool.map((t) => scoreOf(t));
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = max - min || 1;
  const selected: CanonicalTrack[] = [];
  const picked = new Set<number>();
  const artistCounts = new Map<string, number>();

  for (let i = 0; i < size && selected.length < size; i += 1) {
    let bestIdx = -1;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let j = 0; j < pool.length; j += 1) {
      if (picked.has(j)) continue;
      const artist = pool[j].artists[0]?.name ?? '';
      const count = artistCounts.get(artist) ?? 0;
      if (maxPerArtist > 0 && count >= maxPerArtist) continue;
      const rank = (scores[j] - min) / span;
      let maxSim = 0;
      for (const k of picked) {
        maxSim = Math.max(maxSim, trackSimilarity(pool[k], pool[j]));
      }
      const value = 0.6 * rank + 0.4 * (1 - maxSim);
      if (value > bestValue) {
        bestValue = value;
        bestIdx = j;
      }
    }
    if (bestIdx === -1) break;
    picked.add(bestIdx);
    selected.push(pool[bestIdx]);
    const artist = pool[bestIdx].artists[0]?.name ?? '';
    artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
  }
  return selected;
}

export interface MoodEntry {
  /** Stable id; mix ids derive from it so the UI keys stay consistent. */
  genreId: number;
  name: string;
  /** Chart/search fallback used when the genre chart comes back thin. */
  search: string;
}

/**
 * Mood pool for cold-start mixes. The old starter table was four hardcoded
 * moods (Chill/Workout/Party/Focus) served identically every day; entries
 * now rotate with the day so cold-start users still see variety.
 * genreIds are official Deezer genre ids; if a chart comes back empty the
 * search fallback covers it, and empty mixes are filtered by the caller.
 */
export const MOOD_POOL: MoodEntry[] = [
  { genreId: 106, name: 'Chill', search: 'chill' },
  { genreId: 113, name: 'Workout', search: 'workout' },
  { genreId: 173, name: 'Party', search: 'party' },
  { genreId: 132, name: 'Pop', search: 'pop hits' },
  { genreId: 152, name: 'Rock', search: 'rock' },
  { genreId: 116, name: 'Hip-Hop', search: 'hip hop' },
  { genreId: 165, name: 'R&B', search: 'r&b soul' },
  { genreId: 85, name: 'Alternative', search: 'indie alternative' },
  { genreId: 129, name: 'Focus', search: 'instrumental focus' },
  { genreId: 0, name: 'Trending', search: 'trending music' },
];

/**
 * Deterministic day rotation: day-of-year × stride keeps picks spread across
 * the pool and changes content daily while staying stable within a day.
 */
export function pickMoodsForDay(
  moods: MoodEntry[],
  dayKeySeed: number,
  count: number
): MoodEntry[] {
  if (moods.length === 0 || count <= 0) return [];
  const stride = Math.max(1, Math.floor(moods.length / count));
  const start = dayKeySeed % moods.length;
  const picked: MoodEntry[] = [];
  const used = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const idx = (start + i * stride) % moods.length;
    const entry = moods[idx];
    if (used.has(idx)) continue;
    used.add(idx);
    picked.push(entry);
  }
  return picked;
}

export function dedupePool(tracks: CanonicalTrack[]): CanonicalTrack[] {
  const seen = new Set<string>();
  const out: CanonicalTrack[] = [];
  for (const t of tracks) {
    const key = `${t.title.toLowerCase().trim()}|${(t.artists[0]?.name ?? '').toLowerCase().trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
