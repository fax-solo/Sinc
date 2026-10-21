/**
 * On-device lyrics via LRCLIB. Mirrors the server's `LrclibProvider`
 * (get → get-without-duration → search + best-match) and its LRC parsing.
 * No API key, LibreCopyright.
 *
 * Failure semantics of the ladder matter downstream: the lyrics store
 * negative-caches a `provider: 'none'` miss for a week, so a miss must only
 * be reported when LRCLIB actually answered. A track whose lookup failed at
 * the transport layer (timeout, 5xx, weak network) throws
 * `LyricsUnreachableError` instead — the store then retries on the next
 * open/download rather than silencing the track for 7 days.
 */
import type { CanonicalTrack, LyricLine, TrackLyrics } from '@sinc/shared';
import { ProviderError, providerFetchJson } from './http';

const BASE_URL = 'https://lrclib.net';
const UA = 'Sinc/1.0 (music player)';
const DEDUP_WINDOW_MS = 6000;
/**
 * Per-request cap. Phone-only deployments ride weak Wi-Fi; the default 10 s
 * turns a full miss into 30 s of dead time. 6 s per step keeps a miss
 * bounded (~18 s absolute worst case) while still beating slow responses.
 */
export const LRCLIB_STEP_TIMEOUT_MS = 6_000;

/** All ladder steps failed at transport level — nothing is known for sure. */
export class LyricsUnreachableError extends Error {
  constructor(message = 'Lyrics provider unreachable') {
    super(message);
    this.name = 'LyricsUnreachableError';
  }
}

interface LrclibItem {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  language?: string | null;
  instrumental?: boolean;
}

function normalize(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      // Arabic visual twin letters fold to their canonical glyph: the same
      // song is spelled alternately with ة/ه and ى/ي across LRCLIB and the
      // catalogs, and exact equality/containment silently failed before.
      .replace(/[\u0629\u06C0\u06C2]/g, '\u0647')
      .replace(/[\u0649\u06CC\u06C1\u06D2]/g, '\u064A')
      .replace(/\u0640/g, '')
      .replace(/\s+/g, ' ')
  );
}

/**
 * Strips consumer suffixes like "(feat. X)", "[Live at …]", "(Deluxe Edition
 * Remix)" — the parenthesized tails that break exact matches against LRCLIB's
 * canonical titles. Only bracket groups containing a variant keyword are
 * dropped; anything else (artist names, subtitles) is preserved, and matching
 * falls back to substring logic so an over-stripped title still scores.
 */
function stripQualifiers(title: string): string {
  const variant =
    /(feat|ft|featuring|with|live|remix|remaster|radio|edit|version|mix|cover|acoustic|acapella|instrumental|perf|deluxe|extended|sped|slowed|reverb)/i;
  let out = title;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = out.replace(/[([{][^)\]}]*[)\]}]/g, (group) =>
      variant.test(group) ? ' ' : group
    );
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function durationDiffMs(aMs: number, bMs: number): number {
  return Math.abs(aMs - bMs);
}

/** Jaccard overlap of word tokens (same semantics as the match engine). */
function tokenOverlap(a: string, b: string): number {
  const at = a.split(' ').filter(Boolean);
  const bt = b.split(' ').filter(Boolean);
  if (at.length === 0 || bt.length === 0) return 0;
  const bs = new Set(bt);
  let shared = 0;
  for (const t of new Set(at)) if (bs.has(t)) shared += 1;
  const union = new Set([...at, ...bt]).size;
  return union === 0 ? 0 : shared / union;
}

function pickBestHit(track: CanonicalTrack, items: LrclibItem[]): LrclibItem | null {
  const title = normalize(stripQualifiers(track.title));
  // Collab entries arrive as one string ("A, B") on LRCLIB's side too; match
  // when ANY of the requested artists appears instead of only the first.
  const artists = track.artists.map((a) => normalize(a.name)).filter(Boolean);
  const durationMs = track.durationMs;

  let best: LrclibItem | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const itemTitle = normalize(stripQualifiers(item.trackName ?? ''));
    const itemArtist = normalize(item.artistName ?? '');
    let score = 0;
    if (itemTitle === title) score += 10;
    else if (itemTitle.includes(title) || title.includes(itemTitle)) score += 5;
    else if (tokenOverlap(itemTitle, title) >= 0.5) score += 5;
    if (artists.some((name) => itemArtist === name)) score += 8;
    else if (artists.some((name) => itemArtist.includes(name))) score += 3;
    else if (artists.some((name) => tokenOverlap(itemArtist, name) >= 0.5)) score += 3;
    if (durationMs > 0 && item.duration) {
      const diff = durationDiffMs(durationMs, item.duration * 1000);
      if (diff < 2500) score += 6;
      else if (diff < 8000) score += 2;
      else score -= Math.min(10, diff / 10000);
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  if (best && bestScore >= 8) return best;
  return null;
}

function fromLrclib(hit: {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  language?: string | null;
}): { synced: string | null; plain: string | null; language: string | null } {
  const synced = hit.syncedLyrics ?? null;
  const plain = hit.plainLyrics ?? null;
  return { synced, plain, language: hit.language ?? null };
}

/** Parses an LRC string into timed lines; collapses identical consecutive frames. */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of lrc.split('\n')) {
    const matches = raw.match(re);
    if (!matches || matches.length === 0) continue;
    const text = (raw.replace(re, '') ?? '').trim();
    if (!text) continue;
    for (const m of matches) {
      const [min, sec, fracRaw] = m.slice(1, -1).split(/[:.]/);
      const minutes = Number(min);
      const seconds = Number(sec);
      const frac = fracRaw ? Number(fracRaw.padEnd(3, '0')) : 0;
      lines.push({ timeMs: minutes * 60_000 + seconds * 1000 + frac, text });
    }
  }
  lines.sort((a, b) => a.timeMs - b.timeMs);
  const deduped: LyricLine[] = [];
  let last: LyricLine | null = null;
  for (const line of lines) {
    if (last && line.text === last.text && line.timeMs - last.timeMs < DEDUP_WINDOW_MS) {
      last = line;
      continue;
    }
    deduped.push(line);
    last = line;
  }
  return deduped;
}

function headers(): Record<string, string> {
  return { Accept: 'application/json', 'User-Agent': UA };
}

/** One ladder probe with outcome semantics. */
interface ProbeResult {
  /** Item payload for `get` endpoints (null when absent). */
  item?: LrclibItem | null;
  /** List payload for `search` endpoints (null when absent). */
  list?: LrclibItem[] | null;
  /** Provider answered with a definitive "no such track" (404 / empty list). */
  absent: boolean;
  /** Request died without an answer (timeout / network / 5xx). */
  failed: boolean;
}

async function probe(url: string): Promise<ProbeResult> {
  try {
    const body = await providerFetchJson<LrclibItem | LrclibItem[]>(
      url,
      headers(),
      LRCLIB_STEP_TIMEOUT_MS
    );
    if (Array.isArray(body)) {
      return { list: body, absent: body.length === 0, failed: false };
    }
    return { item: body, absent: false, failed: false };
  } catch (err) {
    // 404 is LRCLIB's explicit "no such track" — authoritative miss evidence.
    const notFound = err instanceof ProviderError && err.status === 404;
    return { absent: notFound, failed: !notFound };
  }
}

export const lrclib = {
  async getLyrics(trackId: string, track: CanonicalTrack): Promise<TrackLyrics> {
    let sawAbsence = false;
    let sawFailure = false;
    const miss: TrackLyrics = {
      trackId,
      provider: 'none',
      synced: false,
      lines: [],
      plain: undefined,
      language: null,
    };

    // 1) exact get with duration
    const durationSec = Math.round(track.durationMs / 1000);
    const exactUrl =
      `${BASE_URL}/api/get?` +
      `track_name=${encodeURIComponent(track.title)}` +
      `&artist_name=${encodeURIComponent(track.artists.map((a) => a.name).join(', '))}` +
      (track.album?.title ? `&album_name=${encodeURIComponent(track.album.title)}` : '') +
      (durationSec > 0 ? `&duration=${durationSec}` : '');
    const exact = await probe(exactUrl);
    if (exact.absent) sawAbsence = true;
    if (exact.failed) sawFailure = true;
    if (exact.item) {
      const hit = fromLrclib(exact.item);
      if (hit.synced || hit.plain) return buildLyrics(trackId, hit);
    }

    // 2) exact get without duration (renames/differing masters)
    const retryUrl =
      `${BASE_URL}/api/get?` +
      `track_name=${encodeURIComponent(track.title)}` +
      `&artist_name=${encodeURIComponent(track.artists.map((a) => a.name).join(', '))}` +
      (track.album?.title ? `&album_name=${encodeURIComponent(track.album.title)}` : '');
    const retry = await probe(retryUrl);
    if (retry.absent) sawAbsence = true;
    if (retry.failed) sawFailure = true;
    if (retry.item) {
      const hit = fromLrclib(retry.item);
      if (hit.synced || hit.plain) return buildLyrics(trackId, hit);
    }

    // 3) search + best match
    const searchUrl =
      `${BASE_URL}/api/search?` +
      `track_name=${encodeURIComponent(track.title)}` +
      `&artist_name=${encodeURIComponent(track.artists.map((a) => a.name).join(', '))}`;
    const search = await probe(searchUrl);
    if (search.list) {
      sawAbsence = true; // an answering search is authoritative evidence
      const best = pickBestHit(track, search.list);
      if (best) {
        const hit = fromLrclib(best);
        if (hit.synced || hit.plain) return buildLyrics(trackId, hit);
      }
    }
    if (search.absent) sawAbsence = true;
    if (search.failed) sawFailure = true;

    // Steps 4-5 only run when LRCLIB actually answered (an authoritative
    // absence). If every probe so far failed at transport level, the links
    // are down — throwing beats stacking ~12 s of doomed requests on top.
    if (sawAbsence) {
      const primaryArtist = track.artists[0]?.name ?? '';
      // 4) qualifier-stripped title against the PRIMARY artist only:
      //    featured-artist strings and "(live/remix)" tails are the two most
      //    common reasons the exact ladder misses a track LRCLIB actually has.
      const stripped = stripQualifiers(track.title);
      if (stripped && normalize(stripped) !== normalize(track.title)) {
        const strippedUrl =
          `${BASE_URL}/api/search?` +
          `track_name=${encodeURIComponent(stripped)}` +
          (primaryArtist ? `&artist_name=${encodeURIComponent(primaryArtist)}` : '');
        const probed = await probe(strippedUrl);
        if (probed.list) {
          sawAbsence = true;
          const best = pickBestHit(track, probed.list);
          if (best) {
            const hit = fromLrclib(best);
            if (hit.synced || hit.plain) return buildLyrics(trackId, hit);
          }
        }
        if (probed.absent) sawAbsence = true;
        if (probed.failed) sawFailure = true;
      }

      // 5) full-text query (title + primary artist) — LRCLIB's fuzzy index is
      //    the catch-all for transliteration/renaming variants the fielded
      //    search refuses.
      const fullText =
        `${BASE_URL}/api/search?q=` +
        encodeURIComponent([stripped || track.title, primaryArtist].filter(Boolean).join(' '));
      const wide = await probe(fullText);
      if (wide.list) {
        sawAbsence = true;
        const best = pickBestHit(track, wide.list);
        if (best) {
          const hit = fromLrclib(best);
          if (hit.synced || hit.plain) return buildLyrics(trackId, hit);
        }
      }
      if (wide.absent) sawAbsence = true;
      if (wide.failed) sawFailure = true;
    }

    // A miss is only trustworthy when LRCLIB actually answered at least once.
    if (!sawAbsence && sawFailure) throw new LyricsUnreachableError();
    return miss;
  },
};

function buildLyrics(
  trackId: string,
  hit: { synced: string | null; plain: string | null; language: string | null }
): TrackLyrics {
  if (hit.synced) {
    const lines = parseLrc(hit.synced);
    if (lines.length > 0) {
      return { trackId, provider: 'lrclib', synced: true, language: hit.language, lines };
    }
  }
  const plain = hit.plain ?? '';
  return {
    trackId,
    provider: 'lrclib',
    synced: false,
    language: hit.language,
    lines: [],
    plain: plain || undefined,
  };
}
