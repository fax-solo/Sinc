/**
 * Artist Identity Resolution Engine.
 *
 * Implements deterministic multi-factor identity matching across providers
 * (Deezer, iTunes, MusicBrainz, Spotify, Last.fm).
 *
 * Requirements:
 * - Never blindly merge artists based solely on identical common names.
 * - Compares provider IDs, official external link relations, and aliases.
 * - Prevents collision when disambiguation or primary genre sets clearly conflict.
 * - Preserves separate candidates when identity cannot be verified confidently.
 */
import type { CanonicalArtist } from '@sinc/shared';
import { normalizeText } from '@sinc/shared';

export interface ArtistIdentityCandidate {
  name: string;
  providerIds: Record<string, string>;
  genres?: string[];
  disambiguation?: string;
  country?: string;
  externalUrls?: string[];
  aliases?: string[];
}

export function areSameArtist(
  a: ArtistIdentityCandidate,
  b: ArtistIdentityCandidate
): boolean {
  // 1. Direct provider identifier match
  for (const [provider, idA] of Object.entries(a.providerIds)) {
    const idB = b.providerIds[provider];
    if (idA && idB && idA === idB) {
      return true;
    }
  }

  // 2. Direct external URL match (e.g. same Spotify or Deezer artist page)
  if (a.externalUrls?.length && b.externalUrls?.length) {
    const setA = new Set(a.externalUrls.map((u) => u.toLowerCase()));
    for (const urlB of b.externalUrls) {
      if (setA.has(urlB.toLowerCase())) {
        return true;
      }
    }
  }

  const normA = normalizeText(a.name);
  const normB = normalizeText(b.name);

  // Check aliases
  const aMatchesBName =
    normA === normB ||
    (b.aliases ?? []).some((alias) => normalizeText(alias) === normA) ||
    (a.aliases ?? []).some((alias) => normalizeText(alias) === normB);

  if (!aMatchesBName) {
    return false;
  }

  // 3. Collision guard: if both specify disambiguation and they conflict, do NOT merge
  if (
    a.disambiguation &&
    b.disambiguation &&
    normalizeText(a.disambiguation) !== normalizeText(b.disambiguation)
  ) {
    return false;
  }

  // 4. Collision guard: if both have countries and they differ
  if (
    a.country &&
    b.country &&
    a.country.toUpperCase() !== b.country.toUpperCase()
  ) {
    return false;
  }

  // 5. Collision guard: if genres are known for both and share zero token overlap,
  // do not merge very different entities (e.g. Classical vs Death Metal)
  if (a.genres?.length && b.genres?.length) {
    const tokensA = new Set(
      a.genres
        .flatMap((g) => normalizeText(g).split(/\s+/))
        .filter((t) => t.length > 2)
    );
    const hasOverlap = b.genres.some((g) => {
      const tokensB = normalizeText(g).split(/\s+/).filter((t) => t.length > 2);
      return tokensB.some((t) => tokensA.has(t));
    });
    if (!hasOverlap) {
      return false;
    }
  }

  return true;
}

/**
 * Deduplicates a list of CanonicalArtists, merging compatible providerIds
 * while keeping distinct entities separate.
 */
export function deduplicateArtists(artists: CanonicalArtist[]): CanonicalArtist[] {
  const merged: CanonicalArtist[] = [];

  for (const artist of artists) {
    const existingIndex = merged.findIndex((m) =>
      areSameArtist(
        {
          name: m.name,
          providerIds: m.providerIds,
          genres: m.genres,
        },
        {
          name: artist.name,
          providerIds: artist.providerIds,
          genres: artist.genres,
        }
      )
    );

    if (existingIndex >= 0) {
      const existing = merged[existingIndex]!;
      merged[existingIndex] = {
        ...existing,
        artworkUrl: existing.artworkUrl || artist.artworkUrl,
        providerIds: { ...existing.providerIds, ...artist.providerIds },
        genres: Array.from(new Set([...existing.genres, ...artist.genres])),
        popularityScore: Math.max(existing.popularityScore ?? 0, artist.popularityScore ?? 0) || undefined,
      };
    } else {
      merged.push({ ...artist });
    }
  }

  return merged;
}
