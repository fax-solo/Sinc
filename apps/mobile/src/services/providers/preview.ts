/**
 * Resolves the trusted short preview used for download fingerprint
 * verification.
 *
 * Catalog rows from iTunes/Deezer normally carry the preview inline, so this is
 * a no-op. Persisted/legacy rows and catalog rows from other providers may not;
 * in that case we look the recording up by its own provider id first (exact
 * identity), then fall back to a strict artist/title search. A preview from a
 * different version would make a good download look wrong, so the fallback
 * uses the same title/artist/variant gates as a save.
 */
import type { CanonicalTrack } from '@sinc/shared';
import { deezer } from './deezer';
import { itunes } from './itunes';
import { searchTitle, validateDownloadHit } from './download-source';

/** track.id -> preview URL. Positive results only; failures retry later. */
const previewCache = new Map<string, string>();
const PREVIEW_CACHE_LIMIT = 500;

function artistOf(track: CanonicalTrack): string {
  return track.artists[0]?.name ?? '';
}

/**
 * Deezer's CDN URLs carry an `exp` epoch (seconds). A persisted row can outlive
 * it, so a stale inline/cached preview must be re-resolved from the provider
 * rather than making every download fail verification.
 */
function isFreshPreviewUrl(url: string): boolean {
  // React Native's URLSearchParams.get is not implemented (it throws), so parse
  // the one query parameter we need with a regex instead of `new URL`.
  // Deezer embeds the expiry inside its `hdnea=exp=...~acl=...` value rather
  // than as a standalone `exp` query key, so match it anywhere a parameter can
  // start.
  const exp = /(?:[?&=~])exp=(\d+)/.exec(url)?.[1];
  if (!exp) return true;
  return Number(exp) * 1000 > Date.now() + 60_000;
}

function candidateMatches(
  requested: CanonicalTrack,
  candidate: CanonicalTrack,
  expectedMs: number | null
): boolean {
  return validateDownloadHit(
    searchTitle(requested.title),
    artistOf(requested),
    candidate.title,
    artistOf(candidate),
    candidate.durationMs,
    expectedMs
  );
}

function usable(candidate: CanonicalTrack, requested: CanonicalTrack, expectedMs: number | null) {
  const preview = candidate.previewUrl;
  if (!preview) return false;
  return isFreshPreviewUrl(preview) && candidateMatches(requested, candidate, expectedMs);
}

/**
 * Returns a preview URL for [track], or null when no trustworthy preview can be
 * found. Network/API failures are non-fatal: the download path then falls back
 * to its metadata/duration gates.
 */
export async function resolvePreviewUrl(track: CanonicalTrack): Promise<string | null> {
  if (track.previewUrl && isFreshPreviewUrl(track.previewUrl)) return track.previewUrl;
  const cached = previewCache.get(track.id);
  if (cached && isFreshPreviewUrl(cached)) return cached;

  const remember = (url: string | undefined): string | null => {
    if (!url) return null;
    previewCache.set(track.id, url);
    if (previewCache.size > PREVIEW_CACHE_LIMIT) {
      const oldest = previewCache.keys().next().value;
      if (oldest) previewCache.delete(oldest);
    }
    return url;
  };

  const providerIds = track.providerIds ?? {};
  // Exact provider ids: trust the id, but still refuse a clearly different
  // title/artist (stale catalog ids happen). Duration is skipped because the
  // catalog's rounded length must not invalidate the provider's own preview.
  const itunesId = providerIds.itunes;
  if (itunesId && itunesId !== '0') {
    try {
      const candidate = await itunes.lookupTrack(itunesId);
      if (candidate && usable(candidate, track, null)) return remember(candidate.previewUrl);
    } catch {
      // fall through
    }
  }
  const deezerId = providerIds.deezer;
  if (deezerId && deezerId !== '0') {
    try {
      const candidate = await deezer.lookupTrack(deezerId);
      if (candidate && usable(candidate, track, null)) return remember(candidate.previewUrl);
    } catch {
      // fall through
    }
  }

  // No usable provider id (or the lookup was incomplete): strict text search.
  const query = `${artistOf(track)} ${searchTitle(track.title)}`.trim();
  if (!query) return null;
  const expectedMs = track.durationMs > 0 ? track.durationMs : null;
  try {
    const candidates = await itunes.searchTracks(query, 10);
    const found = candidates.find((candidate) => usable(candidate, track, expectedMs));
    if (found) return remember(found.previewUrl);
  } catch {
    // fall through to Deezer
  }
  try {
    const candidates = await deezer.searchTracks(query, 10);
    const found = candidates.find((candidate) => usable(candidate, track, expectedMs));
    if (found) return remember(found.previewUrl);
  } catch {
    // no preview available
  }
  return null;
}

/** Test isolation. */
export function resetPreviewCache(): void {
  previewCache.clear();
}
