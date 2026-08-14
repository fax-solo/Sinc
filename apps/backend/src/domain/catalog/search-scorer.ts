import {
  type RawTrack,
  levenshteinSimilarity,
  normalizeArtist,
  normalizeTitle,
  durationsCompatible,
} from '@sinc/shared';
import { PROVIDER_CONFIDENCE } from './normalize.js';

export interface NormalizedQuery {
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  isrc?: string;
  version?: string;
}

export interface ScoreBreakdown {
  total: number;
  titleScore: number;
  artistScore: number;
  albumScore: number;
  durationScore: number;
  isrcScore: number;
  versionScore: number;
  popularityScore: number;
  providerScore: number;
}

export interface ScorerWeights {
  title: number;
  artist: number;
  album: number;
  duration: number;
  isrc: number;
  version: number;
  popularity: number;
  provider: number;
}

/** Tunable weights; default matches ARCHITECTURE_PROVIDERS.md. */
export const DEFAULT_WEIGHTS: ScorerWeights = {
  title: 0.35,
  artist: 0.3,
  album: 0.1,
  duration: 0.05,
  isrc: 0.1,
  version: 0.05,
  popularity: 0.03,
  provider: 0.02,
};

export function parseQuery(
  raw: string,
  opts?: { artist?: string; album?: string },
): NormalizedQuery {
  return {
    title: raw.trim(),
    artist: opts?.artist ? opts.artist.trim() : undefined,
    album: opts?.album ? opts.album.trim() : undefined,
  };
}

/** Score title similarity in [0,1]: exact > substring > fuzzy. */
export function titleScore(query: string, title: string): number {
  const q = normalizeTitle(query);
  const t = normalizeTitle(title);
  if (q === t) return 1.0;
  if (t.includes(q)) return 0.9;
  if (q.includes(t)) return 0.7;
  return Math.max(0, levenshteinSimilarity(q, t));
}

/** Score best artist-name match in [0,1]. */
export function artistScore(query: string, artistNames: readonly string[]): number {
  const q = normalizeArtist(query);
  if (artistNames.length === 0) return 0;
  let best = 0;
  for (const name of artistNames) {
    const n = normalizeArtist(name);
    let s: number;
    if (q === n) s = 1.0;
    else if (n.includes(q)) s = 0.9;
    else if (q.includes(n)) s = 0.7;
    else s = Math.max(0, levenshteinSimilarity(q, n));
    best = Math.max(best, s);
  }
  return best;
}

/** Album title match in [0,1]. */
export function albumScore(query: string | undefined, albumTitle: string | undefined): number {
  if (!query || !albumTitle) return 0.5;
  return titleScore(query, albumTitle);
}

/** Graded duration compatibility: exact 1.0, within tolerance 0.8, else 0. */
export function durationScore(queryMs: number | undefined, resultMs: number | undefined): number {
  if (queryMs == null || resultMs == null) return 0.5;
  if (queryMs === resultMs) return 1.0;
  if (durationsCompatible(queryMs, resultMs)) return 0.8;
  return 0;
}

export function isrcScore(queryIsrc: string | undefined, resultIsrc: string | undefined): number {
  if (!queryIsrc) return 0.5;
  if (!resultIsrc) return 0;
  return queryIsrc.toUpperCase() === resultIsrc.toUpperCase() ? 1 : 0;
}

/** Version agreement: neutral when unknown, penalized on conflict. */
export function versionScore(
  queryVersion: string | undefined,
  resultVersion: string | undefined,
): number {
  if (!queryVersion && !resultVersion) return 1.0;
  if (queryVersion && resultVersion) {
    return normalizeTitle(queryVersion) === normalizeTitle(resultVersion) ? 1.0 : 0;
  }
  return 0.6;
}

/** Map provider-reported popularity (0-100) into [0,1]. */
export function normalizePopularity(popularity: number | undefined): number {
  if (popularity == null || popularity <= 0) return 0.5;
  return Math.min(1, popularity / 100);
}

/**
 * Weighted relevance scorer for a RawTrack against a query. Only components
 * with a comparable signal participate so totals stay in [0,1] regardless of
 * what the query or the provider supplied.
 */
export class SearchScorer {
  constructor(private readonly weights: ScorerWeights = DEFAULT_WEIGHTS) {}

  score(query: NormalizedQuery, result: RawTrack): ScoreBreakdown {
    const parts: ScoreBreakdown = {
      total: 0,
      titleScore: titleScore(query.title, result.title),
      artistScore: artistScore(query.artist ?? query.title, result.artistNames),
      albumScore: albumScore(query.album, result.albumTitle),
      durationScore: durationScore(query.durationMs, result.durationMs),
      isrcScore: isrcScore(query.isrc, result.isrc),
      versionScore: versionScore(query.version, result.version),
      popularityScore: normalizePopularity(result.popularity),
      providerScore: PROVIDER_CONFIDENCE[result.provider] ?? 0.5,
    };

    const applicable: Array<keyof ScorerWeights> = ['title'];
    if (query.artist) applicable.push('artist');
    else parts.artistScore = 0.5;
    if (query.album) applicable.push('album');
    if (query.durationMs != null && result.durationMs != null) applicable.push('duration');
    if (query.isrc != null) applicable.push('isrc');
    if (query.version != null) applicable.push('version');
    if (result.popularity != null && result.popularity > 0) applicable.push('popularity');
    applicable.push('provider');

    const totalWeight = applicable.reduce((sum, key) => sum + this.weights[key], 0);
    parts.total =
      applicable.reduce(
        (sum, key) => sum + parts[`${key}Score` as keyof ScoreBreakdown] * this.weights[key],
        0,
      ) / totalWeight;

    return parts;
  }
}
