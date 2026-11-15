/**
 * Intelligent Music Search Engine Core:
 * - Query parsing & tokenization
 * - Version / variant detection
 * - Multi-factor relevance scoring
 * - Confidence estimation
 * - Smart track deduplication with provider ID merging
 */

import type { CanonicalAlbum, CanonicalPlaylist, CanonicalTrack } from '../types/index.js';
import { compactText, normalizeText, tokenize } from './text.js';

export type SearchConfidence = 'high' | 'medium' | 'low';

export interface ScoredTrack {
  track: CanonicalTrack;
  score: number;
  confidence: SearchConfidence;
  matchReasons: string[];
}

export interface ParsedSearchQuery {
  raw: string;
  normalized: string;
  tokens: string[];
  artistHint?: string;
  titleHint?: string;
  requestedVersion?: string;
  hasArtistSeparator: boolean;
}

export const KNOWN_VERSION_TAGS = [
  'remix',
  'remaster',
  'remastered',
  'live',
  'acoustic',
  'instrumental',
  'cover',
  'karaoke',
  'mashup',
  'sped up',
  'slowed',
  'reverb',
  '8d',
  'extended',
  'radio edit',
  'edit',
  'clean',
  'explicit',
  'club mix',
  'original mix',
] as const;

/**
 * Detects version tags in a title or query string.
 */
export function detectVersion(text: string): string | null {
  const norm = ` ${normalizeText(text)} `;
  for (const tag of KNOWN_VERSION_TAGS) {
    const pattern = ` ${normalizeText(tag)} `;
    if (norm.includes(pattern)) {
      return tag;
    }
  }
  return null;
}

/**
 * Strips known version tags and parentheticals to extract the core stem.
 */
export function extractBaseStem(title: string): string {
  // Strip content in parentheses / brackets
  const withoutParens = title.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  let norm = normalizeText(withoutParens);
  for (const tag of KNOWN_VERSION_TAGS) {
    norm = norm.replace(new RegExp(`\\b${normalizeText(tag)}\\b`, 'g'), ' ');
  }
  return norm.trim().replace(/\s+/g, ' ');
}

/**
 * Parses user input to extract artist hints, title hints, and requested versions.
 * Handles patterns like "Artist - Title", "Title - Artist", "Artist : Title", etc.
 */
export function parseQuery(query: string): ParsedSearchQuery {
  const trimmed = query.trim();
  const normalized = normalizeText(trimmed);
  const tokens = tokenize(trimmed);
  const requestedVersion = detectVersion(trimmed) ?? undefined;

  // Check for common artist/title separators: " - ", " : ", " by "
  const separatorMatch = trimmed.match(/\s+[-–—:]\s+|\s+by\s+/i);
  if (separatorMatch && separatorMatch.index !== undefined) {
    const part1 = trimmed.slice(0, separatorMatch.index).trim();
    const part2 = trimmed.slice(separatorMatch.index + separatorMatch[0].length).trim();
    return {
      raw: trimmed,
      normalized,
      tokens,
      artistHint: normalizeText(part2),
      titleHint: normalizeText(part1),
      requestedVersion,
      hasArtistSeparator: true,
    };
  }

  return {
    raw: trimmed,
    normalized,
    tokens,
    requestedVersion,
    hasArtistSeparator: false,
  };
}

/**
 * Calculates a Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const m = a.length;
  const n = b.length;
  const dp: number[] = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) {
    dp[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    let prevDiag = dp[0] ?? 0;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j] ?? 0;
      if (a.charAt(i - 1) === b.charAt(j - 1)) {
        dp[j] = prevDiag;
      } else {
        const insertOrDelete = Math.min(dp[j - 1] ?? 0, dp[j] ?? 0);
        dp[j] = Math.min(prevDiag, insertOrDelete) + 1;
      }
      prevDiag = temp;
    }
  }

  return dp[n] ?? Math.max(m, n);
}

/**
 * Normalized string similarity ratio between 0.0 and 1.0.
 */
export function stringSimilarity(a: string, b: string): number {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(normA, normB);
  return Math.max(0, 1.0 - dist / maxLen);
}

/**
 * Scores a track against the parsed search query.
 */
export function scoreTrack(query: string | ParsedSearchQuery, track: CanonicalTrack): ScoredTrack {
  const parsed = typeof query === 'string' ? parseQuery(query) : query;
  const qNorm = parsed.normalized;
  const trackTitleNorm = normalizeText(track.title);
  const baseTitleNorm = extractBaseStem(track.title);
  const primaryArtist = track.artists[0]?.name ? normalizeText(track.artists[0].name) : '';
  const allArtists = track.artists.map((a) => normalizeText(a.name));
  const trackVersion = detectVersion(track.title);

  let score = 0;
  const matchReasons: string[] = [];

  // 1. Exact Full Query Matches
  if (trackTitleNorm === qNorm) {
    score += 120;
    matchReasons.push('exact_title');
  } else if (baseTitleNorm === qNorm) {
    score += 110;
    matchReasons.push('exact_base_title');
  } else if (trackTitleNorm.startsWith(qNorm)) {
    score += 85;
    matchReasons.push('title_starts_with');
  } else if (trackTitleNorm.includes(qNorm)) {
    score += 65;
    matchReasons.push('title_contains');
  }

  // 2. Artist Matching
  const isPrimaryArtistExact = primaryArtist === qNorm;
  const isAnyArtistExact = allArtists.includes(qNorm);
  if (isPrimaryArtistExact) {
    score += 90;
    matchReasons.push('exact_artist');
  } else if (isAnyArtistExact) {
    score += 75;
    matchReasons.push('exact_featured_artist');
  } else if (
    primaryArtist &&
    (primaryArtist.startsWith(qNorm) || qNorm.startsWith(primaryArtist))
  ) {
    score += 55;
    matchReasons.push('artist_prefix_match');
  } else if (allArtists.some((a) => a.includes(qNorm))) {
    score += 40;
    matchReasons.push('artist_contains');
  }

  // 3. Multi-token decomposition & Compound Matches (e.g. "After Dark - Mr.Kitty" or "The Weeknd Blinding Lights")
  if (parsed.tokens.length > 1) {
    const titleTokens = tokenize(track.title);
    const artistTokens = allArtists.flatMap((a) => tokenize(a));

    let matchingTitleTokens = 0;
    let matchingArtistTokens = 0;

    for (const t of parsed.tokens) {
      if (titleTokens.some((tok) => tok === t || (t.length > 3 && tok.startsWith(t)))) {
        matchingTitleTokens += 1;
      }
      if (artistTokens.some((tok) => tok === t || (t.length > 3 && tok.startsWith(t)))) {
        matchingArtistTokens += 1;
      }
    }

    // If query matches both artist AND title tokens
    if (matchingTitleTokens > 0 && matchingArtistTokens > 0) {
      const comboBonus = 120 + Math.min(60, (matchingTitleTokens + matchingArtistTokens) * 15);
      score += comboBonus;
      matchReasons.push(`artist_and_title_combo(+${comboBonus})`);
    } else if (matchingTitleTokens > 0) {
      const titleBonus = Math.min(50, matchingTitleTokens * 20);
      score += titleBonus;
      matchReasons.push(`title_tokens(+${titleBonus})`);
    }

    // Check specific artistHint / titleHint if separator was present
    if (parsed.hasArtistSeparator && parsed.titleHint && parsed.artistHint) {
      const hintTitleSim = Math.max(
        stringSimilarity(parsed.titleHint, trackTitleNorm),
        stringSimilarity(parsed.titleHint, primaryArtist)
      );
      const hintArtistSim = Math.max(
        stringSimilarity(parsed.artistHint, primaryArtist),
        stringSimilarity(parsed.artistHint, trackTitleNorm)
      );
      if (hintTitleSim > 0.8 && hintArtistSim > 0.7) {
        score += 80;
        matchReasons.push('structured_hint_match');
      }
    }
  }

  // 4. Compact string match (handles punctuation like "OT$HA" -> "otsha")
  const compactQ = compactText(parsed.raw);
  const compactTitle = compactText(track.title);
  if (compactTitle === compactQ && !matchReasons.includes('exact_title')) {
    score += 90;
    matchReasons.push('compact_title_match');
  }

  // 5. Version Awareness
  if (parsed.requestedVersion) {
    if (trackVersion && trackVersion === parsed.requestedVersion) {
      score += 70;
      matchReasons.push(`requested_version_match(${trackVersion})`);
    } else if (!trackVersion) {
      score -= 25;
      matchReasons.push('missing_requested_version');
    }
  } else {
    // If the user did NOT request a version (e.g. searching for clean "Hotel California"):
    // Heavily prioritize the original studio cut over live, remixes, covers, karaoke
    if (trackVersion) {
      if (['remix', 'mashup', 'sped up', 'slowed'].includes(trackVersion)) {
        score -= 40;
        matchReasons.push(`penalize_unrequested_${trackVersion}`);
      } else if (['live', 'cover', 'karaoke', 'instrumental', 'acoustic'].includes(trackVersion)) {
        score -= 30;
        matchReasons.push(`penalize_unrequested_${trackVersion}`);
      }
    }
  }

  // 6. Metadata Completeness & Quality signals
  if (track.album && track.album.title && track.album.title !== 'Unknown Album') {
    score += 5;
  }
  if (track.artworkUrl) {
    score += 5;
  }
  if (track.durationMs && track.durationMs > 30000 && track.durationMs < 1200000) {
    score += 5;
  }

  // 7. Confidence Classification
  let confidence: SearchConfidence = 'low';
  if (
    score >= 120 ||
    matchReasons.includes('exact_title') ||
    matchReasons.some((r) => r.startsWith('artist_and_title_combo'))
  ) {
    confidence = 'high';
  } else if (
    score >= 60 ||
    matchReasons.includes('exact_artist') ||
    matchReasons.includes('title_starts_with')
  ) {
    confidence = 'medium';
  }

  return {
    track,
    score: Math.max(0, score),
    confidence,
    matchReasons,
  };
}

/**
 * Scores a playlist against the search query.
 */
export function scorePlaylist(query: string, playlist: CanonicalPlaylist): number {
  const qNorm = normalizeText(query);
  const nameNorm = normalizeText(playlist.name);
  let s = 0;
  if (nameNorm === qNorm) s += 120;
  else if (nameNorm.startsWith(qNorm)) s += 85;
  else if (nameNorm.includes(qNorm)) s += 60;

  if (playlist.owner?.name && normalizeText(playlist.owner.name).includes(qNorm)) {
    s += 25;
  }
  if (playlist.trackCount && playlist.trackCount > 0) {
    s += Math.min(10, Math.floor(playlist.trackCount / 5));
  }
  return s;
}

/**
 * Merges and deduplicates track results from multiple providers.
 * Merges provider IDs so downstream playback and download source selection
 * have full access to both providers (e.g., both iTunes and Deezer IDs).
 * Distinguishes between distinct versions (original vs remix vs live).
 */
export function mergeAndDedupeTracks(tracks: CanonicalTrack[], query?: string): CanonicalTrack[] {
  const merged: CanonicalTrack[] = [];
  // Map of canonical key -> list of indices in merged sharing the same base title + artist + version
  const candidatesByKey = new Map<string, number[]>();

  for (const track of tracks) {
    const baseTitle = extractBaseStem(track.title);
    const artist = normalizeText(track.artists[0]?.name ?? '');
    const version = detectVersion(track.title) ?? 'original';

    const baseKey = `${baseTitle}|${artist}|${version}`;
    const candidateIndices = candidatesByKey.get(baseKey);
    let matchedIndex: number | undefined;

    if (candidateIndices) {
      for (const idx of candidateIndices) {
        const candidate = merged[idx];
        if (
          candidate &&
          (candidate.durationMs <= 0 ||
            track.durationMs <= 0 ||
            Math.abs(candidate.durationMs - track.durationMs) <= 7000)
        ) {
          matchedIndex = idx;
          break;
        }
      }
    }

    if (matchedIndex !== undefined) {
      const existing = merged[matchedIndex];
      if (existing) {
        // Merge provider IDs onto the existing winner
        existing.providerIds = {
          ...existing.providerIds,
          ...track.providerIds,
        };
        // Enrich artwork or previewUrl if existing lacks it
        if (!existing.artworkUrl && track.artworkUrl) {
          existing.artworkUrl = track.artworkUrl;
        }
        if (!existing.previewUrl && track.previewUrl) {
          existing.previewUrl = track.previewUrl;
        }
      }
      continue;
    }

    const newIndex = merged.length;
    merged.push({ ...track, providerIds: { ...track.providerIds } });
    if (candidateIndices) {
      candidateIndices.push(newIndex);
    } else {
      candidatesByKey.set(baseKey, [newIndex]);
    }
  }

  // If query is provided, sort by multi-factor score
  if (query) {
    const parsed = parseQuery(query);
    return merged
      .map((t) => scoreTrack(parsed, t))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.track);
  }

  return merged;
}

export interface PersonalizationSearchSignals {
  favoriteTrackIds?: ReadonlySet<string>;
  playedTrackIds?: ReadonlySet<string>;
  followedArtistNames?: ReadonlySet<string>;
  favoriteArtistNames?: ReadonlySet<string>;
  downloadedTrackIds?: ReadonlySet<string>;
  enabled?: boolean;
}

/**
 * Deduplicates albums across multiple providers by matching normalized title and artist name.
 */
export function deduplicateAlbums(albums: CanonicalAlbum[]): CanonicalAlbum[] {
  const merged: CanonicalAlbum[] = [];
  const seen = new Map<string, number>();

  for (const album of albums) {
    const key = `${normalizeText(album.title)}|${normalizeText(album.artist?.name ?? '')}`;
    const existingIndex = seen.get(key);
    if (existingIndex !== undefined) {
      const existing = merged[existingIndex]!;
      merged[existingIndex] = {
        ...existing,
        artworkUrl: existing.artworkUrl || album.artworkUrl,
        providerIds: { ...existing.providerIds, ...album.providerIds },
        trackCount: Math.max(existing.trackCount, album.trackCount),
        releaseDate: existing.releaseDate || album.releaseDate,
        year: existing.year || album.year,
      };
    } else {
      seen.set(key, merged.length);
      merged.push({ ...album, providerIds: { ...album.providerIds } });
    }
  }

  return merged;
}

/**
 * Ranks tracks by combining base search relevance with subtle personalization signals.
 * Guarantees that exact text matches always dominate, while giving a controlled boost
 * to user favorites, previous plays, and followed artists within competitive matches.
 */
export function rankPersonalizedTracks(
  query: string,
  tracks: CanonicalTrack[],
  signals?: PersonalizationSearchSignals
): ScoredTrack[] {
  const parsed = parseQuery(query);
  const enabled = signals?.enabled ?? true;

  const scoredList = tracks.map((track) => {
    const scored = scoreTrack(parsed, track);
    let boost = 0;

    if (enabled && signals) {
      // Only apply personalization boost if the track has baseline text relevance (score >= 40).
      // This guarantees an unrelated favorited track NEVER outranks an exact match.
      if (scored.score >= 40) {
        if (signals.favoriteTrackIds?.has(track.id)) boost += 15;
        if (signals.playedTrackIds?.has(track.id)) boost += 10;
        if (signals.downloadedTrackIds?.has(track.id)) boost += 8;

        const leadArtist = track.artists[0]?.name.toLowerCase();
        if (leadArtist) {
          if (signals.favoriteArtistNames?.has(leadArtist)) boost += 10;
          else if (signals.followedArtistNames?.has(leadArtist)) boost += 8;
        }
        boost = Math.min(25, boost);
      }
    }

    return {
      track: scored.track,
      score: scored.score + boost,
      confidence: scored.confidence,
      matchReasons:
        boost > 0
          ? [...scored.matchReasons, `personal_affinity(+${boost})`]
          : scored.matchReasons,
    };
  });

  return scoredList.sort((a, b) => b.score - a.score);
}

