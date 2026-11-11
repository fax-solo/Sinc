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
/** A mix below this size is too thin to be worth showing. */
export const MIN_MIX_SIZE = 5;
/** Max tracks per lead artist in one mix (Spotify keeps mixes varied this way). */
export const MAX_PER_ARTIST = 3;

/**
 * Share of unfamiliar artists in a mix. Mirrors the server engine: even the
 * most familiar setting keeps ~20% discovery, and the slider takes it to 100%.
 */
export function freshRatioFor(preference: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(preference) ? preference : 0.5));
  return 0.2 + 0.8 * clamped;
}

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
  maxPerArtist = MAX_PER_ARTIST,
  initialArtistCounts?: ReadonlyMap<string, number>
): CanonicalTrack[] {
  if (pool.length === 0 || size <= 0) return [];
  const scores = pool.map((t) => scoreOf(t));
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = max - min || 1;
  const selected: CanonicalTrack[] = [];
  const picked = new Set<number>();
  const artistCounts = new Map<string, number>(initialArtistCounts ?? []);

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

export interface FreshAwareMixOptions {
  /** 0 = mostly familiar, 1 = mostly unfamiliar. */
  freshRatio: number;
  /** Lower-cased artist names the listener already knows. */
  knownArtistNames: ReadonlySet<string>;
  scoreOf: (track: CanonicalTrack) => number;
  excludeTrackIds?: ReadonlySet<string>;
  maxPerArtist?: number;
}

/**
 * Selects a mix with an explicit fresh/known split. Pools are shuffled by the
 * caller with the day seed; this function only decides how many slots each
 * side gets, then delegates to the MMR selector for diversity.
 */
export function selectFreshAwareMixTracks(
  pool: CanonicalTrack[],
  size: number,
  options: FreshAwareMixOptions
): CanonicalTrack[] {
  if (pool.length === 0 || size <= 0) return [];
  const knownLower = new Set(
    [...options.knownArtistNames].map((name) => name.toLowerCase())
  );
  const fresh: CanonicalTrack[] = [];
  const known: CanonicalTrack[] = [];
  const seen = new Set(options.excludeTrackIds ?? []);
  for (const track of pool) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    const artist = (track.artists[0]?.name ?? '').toLowerCase();
    if (artist && knownLower.has(artist)) known.push(track);
    else fresh.push(track);
  }

  const freshSlots = Math.round(size * Math.min(1, Math.max(0, options.freshRatio)));
  const knownPicked = selectMixTracks(
    known,
    size - freshSlots,
    options.scoreOf,
    options.maxPerArtist
  );
  let freshPicked = selectMixTracks(
    fresh,
    freshSlots,
    options.scoreOf,
    options.maxPerArtist
  );

  // A thin side should not leave holes in the mix.
  const artistCountsFor = (tracks: CanonicalTrack[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const track of tracks) {
      const artist = track.artists[0]?.name ?? '';
      counts.set(artist, (counts.get(artist) ?? 0) + 1);
    }
    return counts;
  };
  const picked = new Set([...knownPicked, ...freshPicked].map((track) => track.id));
  if (knownPicked.length + freshPicked.length < size) {
    const leftoverFresh = fresh.filter((track) => !picked.has(track.id));
    freshPicked = [
      ...freshPicked,
      ...selectMixTracks(
        leftoverFresh,
        size - knownPicked.length - freshPicked.length,
        options.scoreOf,
        options.maxPerArtist,
        artistCountsFor([...knownPicked, ...freshPicked])
      ),
    ];
  }
  if (knownPicked.length + freshPicked.length < size) {
    const used = new Set([...knownPicked, ...freshPicked].map((track) => track.id));
    const leftoverKnown = known.filter((track) => !used.has(track.id));
    knownPicked.push(
      ...selectMixTracks(
        leftoverKnown,
        size - knownPicked.length - freshPicked.length,
        options.scoreOf,
        options.maxPerArtist,
        artistCountsFor([...knownPicked, ...freshPicked])
      )
    );
  }

  // Familiar tracks first; the fresh tail still gets heard.
  return [...knownPicked, ...freshPicked].slice(0, size);
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
