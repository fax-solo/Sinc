import type { CanonicalTrack, ResolvedSource, SourceCandidate } from '@sinc/shared';
import { normalizeTitle } from '@sinc/shared';

export interface SourceResolverConfig {
  /** Below this score no source is ever auto-selected. */
  minConfidence: number;
  /** Duration (ms) mismatch penalty applies within ± this window. */
  durationToleranceMs: number;
}

export const DEFAULT_RESOLVER_CONFIG: SourceResolverConfig = {
  minConfidence: 0.7,
  durationToleranceMs: 3_000,
};

/**
 * Chooses the single best playable source for a canonical track from provider
 * candidates. ISRC-first scoring: an exact ISRC match is nearly conclusive,
 * otherwise title + artist + duration similarity decides. Confidence is scaled
 * by the provider's historical reliability; anything below the threshold is
 * never selected (the caller surfaces a clean "no playable source").
 */
export class SourceResolverService {
  constructor(private readonly config: SourceResolverConfig = DEFAULT_RESOLVER_CONFIG) {}

  resolve(track: CanonicalTrack, candidates: SourceCandidate[]): ResolvedSource | null {
    let best: { url: string; candidate: SourceCandidate; score: number } | null = null;
    for (const candidate of candidates) {
      const url = candidate.url;
      if (!url) continue;
      const score = this.score(track, candidate);
      if (best === null || score > best.score) best = { url, candidate, score };
    }
    if (!best || best.score < this.config.minConfidence) return null;

    const { url, candidate, score } = best;
    return {
      provider: candidate.provider,
      type: 'stream',
      url,
      format: candidate.format,
      durationMs: candidate.durationMs,
      confidence: score,
    };
  }

  score(track: CanonicalTrack, candidate: SourceCandidate): number {
    const reliability = clamp(candidate.sourceReliability ?? 1, 0.1, 1);
    let base = 0;

    const isrcExact =
      !!track.isrc && !!candidate.isrc && candidate.isrc.toUpperCase() === track.isrc.toUpperCase();
    if (isrcExact) {
      base = 1;
    } else {
      const titleMatch = normalizeTitle(candidate.title) === normalizeTitle(track.title);
      const artistMatch = this.artistMatch(track, candidate.artistNames);
      const durationOk =
        candidate.durationMs == null ||
        Math.abs(candidate.durationMs - track.durationMs) <= this.config.durationToleranceMs;

      base = (titleMatch ? 0.6 : 0) + (artistMatch ? 0.3 : 0) + (durationOk ? 0.1 : 0);
    }

    return round3(base * reliability);
  }

  private artistMatch(track: CanonicalTrack, candidateArtists: string[]): boolean {
    const names = new Set(track.artists.map((a) => normalizeTitle(a.name)));
    return candidateArtists.some((name) => names.has(normalizeTitle(name)));
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
