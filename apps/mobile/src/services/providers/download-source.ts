/**
 * Direct, keyless (or config-keyed) download sources: Internet Archive, and
 * optional Jamendo/FMA when API keys are configured. yt-dlp (SoundCloud /
 * YouTube) is handled separately through the native yt module. Mirrors the
 * server's `download-source.ts` chain order: SoundCloud -> YouTube ->
 * Jamendo -> Archive -> FMA.
 */
import type { CanonicalTrack } from '@sinc/shared';
import { providerFetchJson } from './http';

export interface LocalDownloadSource {
  url: string;
  provider: 'archive' | 'jamendo' | 'fma';
  mimeType: string;
  /** Expected duration in ms when known (minimum-acceptance guard). */
  expectedDurationMs?: number;
}

export function searchQuery(track: CanonicalTrack): string {
  return `${track.artists[0]?.name ?? 'Unknown'} - ${searchTitle(track.title)}`;
}

/** Keeps variant tags like "(Remix)"/" - Live" but drops alt-title parens. */
export function searchTitle(title: string): string {
  let out = title
    .trim()
    .replace(/\([^)]+live[^)]*\)/gi, '')
    .replace(/\([^)]+radio[^)]*\)/gi, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const parens = out.match(/\(.+\)$/);
  if (parens) {
    const inner = parens[0].slice(1, -1).toLowerCase();
    // Keep clear variants, drop anything else parenthesized (alt titles).
    const isVariant =
      /remix|edit|mix\b|version|rework|instrumental|acoustic|demo|live|radio|extended/.test(inner);
    if (!isVariant) out = out.slice(0, -parens[0].length).trim();
  }
  return out;
}

// --- shared request-vs-candidate validation ----------------------------------
// The direct tier (Archive/Jamendo/FMA) returns search results whose FIRST
// entry used to be taken blindly — that is how a different song got saved.
// Every candidate now must pass the same resemblance gates the yt-dlp path
// enforces (title gate + artist signal + tight duration).

function normalizeForMatch(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function compactForMatch(input: string): string {
  return normalizeForMatch(input).replace(/ /gu, '');
}

function tokenSimilarityForMatch(a: string, b: string): number {
  const ta = a.split(' ').filter(Boolean);
  const tb = b.split(' ').filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  const intersection = ta.filter((t) => setB.has(t)).length;
  const union = ta.length + tb.length - intersection;
  return union === 0 ? 0 : intersection / union;
}

// --- variant gates (mirror of SincTrackMatch) ---------------------------------
// The yt-dlp tier refuses altered uploads ("sped up", karaoke, covers, live
// recordings...) unless the query asked for them. The direct tier (Archive /
// Jamendo / FMA) runs the identical rule so a direct download can never save
// an alteration the engine tier would have refused. Boundary-safe matching:
// words that merely CONTAIN a tag ("Stayin' Alive" ⊃ "live") are not variants;
// plurals/derivatives ("remastered", "remixes", "edits") still are.
const TOKEN_SUFFIXES = new Set(['s', 'es', 'ed', 'ing']);

function hasTag(normalizedText: string, rawTag: string): boolean {
  const tag = normalizeForMatch(rawTag);
  if (!tag) return false;
  if (tag.includes(' ')) return ` ${normalizedText} `.includes(` ${tag} `);
  return normalizedText
    .split(' ')
    .some(
      (token) =>
        token === tag ||
        (token.length > tag.length &&
          token.startsWith(tag) &&
          TOKEN_SUFFIXES.has(token.slice(tag.length)))
    );
}

const FORBIDDEN_VARIANT_TAGS = [
  'sped up',
  'spedup',
  'sped-up',
  'slowed',
  'slow + reverb',
  'slowed + reverb',
  'reverb',
  'nightcore',
  'daycore',
  '8d audio',
  '8d',
  'loop',
  '1 hour',
  '10 hour',
  'hour loop',
  'hour version',
  'karaoke',
  'instrumental',
  'cover',
  'mashup',
  'bootleg',
  'tiktok version',
  'tiktok remix',
  // Live recordings (crowd noise, different timing) break lyrics sync and
  // are never what "the song" means unless explicitly requested.
  'live',
  'unplugged',
  'in concert',
] as const;

/** True when the result is a labeled variant the query did not ask for. */
export function hasForbiddenVariant(query: string, resultTitle: string): boolean {
  const q = normalizeForMatch(query);
  const r = normalizeForMatch(resultTitle);
  return FORBIDDEN_VARIANT_TAGS.some((tag) => hasTag(r, tag) && !hasTag(q, tag));
}

// --- artist credits ------------------------------------------------------------
// "A, B" / "A & B" / "A feat. B" requests express several artists; evidence
// from ANY credit counts (traction for collabs on Archive uploads where only
// the main artist appears in the item's creator field).
const CREDIT_SEPARATORS = /\s*(?:,|&|\+|\b(?:feat(?:\.|uring)?|ft|duet|versus|vs|x|with)\b)\s*/i;

function artistCredits(artist: string): string[] {
  return artist
    .split(CREDIT_SEPARATORS)
    .map((c) => c.trim())
    .filter((c) => normalizeForMatch(c).length > 0);
}

function matchesArtist(requestedArtist: string, candidateArtist: string): boolean {
  const c = compactForMatch(requestedArtist);
  if (!c) return false;
  const u = compactForMatch(candidateArtist);
  if (!u) return false;
  if (u.includes(c) || c.includes(u)) return true;
  if (
    tokenSimilarityForMatch(
      normalizeForMatch(requestedArtist),
      normalizeForMatch(candidateArtist)
    ) >= 0.5
  ) {
    return true;
  }
  return artistCredits(requestedArtist).some((credit) => {
    const cc = compactForMatch(credit);
    if (!cc) return false;
    if (u.includes(cc) || cc.includes(u)) return true;
    return (
      tokenSimilarityForMatch(normalizeForMatch(credit), normalizeForMatch(candidateArtist)) >= 0.5
    );
  });
}

/**
 * Title/artist/duration similarity of a direct-tier result versus the
 * request. Requires a title resemblance (containment or >= 0.34 token
 * overlap) AND an artist signal when the caller knows the artist — the same
 * policy as SincTrackMatch on the native side. Unknown durations neither pass
 * nor fail the check.
 *
 * Variant guard (mirror of the yt-dlp tier): a labeled alteration the query
 * did not ask for ("(Live)", "(Sped Up)", karaoke) is refused so the direct
 * downloads can never save a copy the engine tier would have rejected.
 */
export function validateSearchHit(
  title: string,
  artist: string,
  resultTitle: string,
  resultArtist: string | undefined,
  durationMs: number,
  expectedMs: number | null
): boolean {
  const q = normalizeForMatch(title);
  const r = normalizeForMatch(resultTitle);
  if (!q || !r) return false;
  const queryText = `${artist} ${title}`;
  if (hasForbiddenVariant(queryText, resultTitle)) return false;
  const containment = r.includes(q) || q.includes(r);
  const titleOk = containment || tokenSimilarityForMatch(q, r) >= 0.34;
  if (!titleOk) return false;
  if (compactForMatch(artist) && !matchesArtist(artist, resultArtist ?? '')) return false;
  if (
    expectedMs != null &&
    expectedMs > 0 &&
    durationMs > 0 &&
    (durationMs < expectedMs * 0.8 || durationMs > expectedMs * 1.25)
  ) {
    return false;
  }
  return true;
}

// --- Internet Archive (no key) -------------------------------------------------

interface ArchiveDoc {
  identifier: string;
}

interface ArchiveMetadata {
  files?: Array<{ name?: string; format?: string }>;
}

/** Audio containers we can play back from an Archive item. */
const ARCHIVE_AUDIO_EXT = /\.(mp3|ogg|oga|m4a|flac|opus|webm|wav)$/i;
/**
 * Archive `format` values are like "VBR MP3" / "Ogg Vorbis" — they never
 * contain the word "audio", so matching on it (old code) rejected every real
 * file. Exclude known non-audio formats instead.
 */
const ARCHIVE_NON_AUDIO_FORMAT =
  /torrent|metadata|jpeg|jpg|png|gif|text|xml|json|video|mpeg4|mp4|pdf|epub|mobi|subtitle|srt|vtt|collection|logo|sqlite/i;

/** Prefers full-quality mp3s over previews, samples and derived junk. */
export function scoreArchiveFile(name: string): number {
  const lower = name.toLowerCase();
  let score = 0;
  if (lower.endsWith('.mp3')) score += 10;
  if (/_64kb|64kb|_samples|samples|preview/.test(lower)) score -= 20;
  if (/spectrogram|waveform|_meta|_files|_archive|cue|log|\\.m3u|\\.pls/.test(lower)) score -= 50;
  return score;
}

export function pickArchiveFile(
  files: Array<{ name?: string; format?: string }>
): { name: string } | null {
  const candidates = (files ?? []).filter(
    (f) =>
      typeof f.name === 'string' &&
      ARCHIVE_AUDIO_EXT.test(f.name) &&
      !ARCHIVE_NON_AUDIO_FORMAT.test(f.format ?? '')
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => scoreArchiveFile(b.name!) - scoreArchiveFile(a.name!));
  return { name: candidates[0].name! };
}

async function archiveSearchDocs(title: string, artist: string): Promise<ArchiveDoc[]> {
  // Fielded queries only. The old bare `"${title}"` text fallback matched
  // descriptions and reviews too — that is how news broadcasts and unrelated
  // compilations got saved as songs. `title:` (item title) is still fielded,
  // so a title-only attempt cannot drift into description matches.
  const queries = artist
    ? [`title:"${title}" AND creator:"${artist}"`, `title:"${title}"`]
    : [`title:"${title}"`];
  for (const q of queries) {
    try {
      const search = await providerFetchJson<{ response?: { docs?: ArchiveDoc[] } }>(
        `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`${q} AND mediatype:audio`)}&fl[]=identifier&rows=5&output=json`
      );
      const docs = search.response?.docs ?? [];
      if (docs.length > 0) return docs;
    } catch {
      continue;
    }
  }
  return [];
}

export async function findArchiveSource(
  track: CanonicalTrack
): Promise<LocalDownloadSource | null> {
  const title = searchTitle(track.title);
  if (!title) return null;
  const artist = track.artists[0]?.name ?? '';
  try {
    const docs = await archiveSearchDocs(title, artist);
    for (const doc of docs) {
      try {
        const meta = await providerFetchJson<ArchiveMetadata>(
          `https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`
        );
        const file = pickArchiveFile(meta.files ?? []);
        if (file?.name) {
          return {
            url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(file.name)}`,
            provider: 'archive',
            mimeType: /\.ogg$/i.test(file.name) ? 'audio/ogg' : 'audio/mpeg',
            // Full expected duration (not a halved guess): the downloader
            // probes the finished file and rejects lengths far from this.
            expectedDurationMs: track.durationMs > 45_000 ? track.durationMs : undefined,
          };
        }
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// --- Jamendo (needs client id) -------------------------------------------------

interface JamendoTrack {
  audio?: string;
  name?: string;
  artist_name?: string;
  duration?: number;
}

interface JamendoResponse {
  results?: JamendoTrack[];
}

export async function findJamendoSource(
  track: CanonicalTrack,
  clientId: string
): Promise<LocalDownloadSource | null> {
  if (!clientId) return null;
  const title = searchTitle(track.title);
  if (!title) return null;
  try {
    const json = await providerFetchJson<JamendoResponse>(
      `https://api.jamendo.com/v3.0/tracks/?client_id=${encodeURIComponent(clientId)}&format=json&limit=5&namesearch=${encodeURIComponent(searchQuery(track))}&audioformat=mp32`
    );
    // Validate before trusting any result — the old code took results[0]
    // blindly. name/artist_name/duration come standard on the tracks endpoint.
    const expectedMs = track.durationMs > 0 ? track.durationMs : null;
    let best: { score: number; url: string } | null = null;
    for (const hit of json.results ?? []) {
      if (!hit.audio || !hit.name) continue;
      const hitMs = (hit.duration ?? 0) > 0 ? Math.round(hit.duration! * 1000) : 0;
      if (
        !validateSearchHit(
          title,
          track.artists[0]?.name ?? '',
          hit.name,
          hit.artist_name,
          hitMs,
          expectedMs
        )
      ) {
        continue;
      }
      const score = hitMs > 0 && expectedMs ? -Math.abs(hitMs - expectedMs) : 0;
      if (!best || score > best.score) best = { score, url: hit.audio };
    }
    if (!best) return null;
    return {
      url: best.url,
      provider: 'jamendo',
      mimeType: 'audio/mpeg',
      expectedDurationMs: track.durationMs > 45_000 ? track.durationMs : undefined,
    };
  } catch {
    return null;
  }
}

// --- Free Music Archive (needs api key) ------------------------------------------

interface FmaTrack {
  track_url?: string;
  track_file?: string;
  title?: string;
  track_title?: string;
  artist_name?: string;
  artist?: string;
  duration?: number;
}

interface FmaResponse {
  dataset?: FmaTrack[];
}

export async function findFmaSource(
  track: CanonicalTrack,
  apiKey: string
): Promise<LocalDownloadSource | null> {
  if (!apiKey) return null;
  const title = searchTitle(track.title);
  if (!title) return null;
  try {
    const json = await providerFetchJson<FmaResponse>(
      `https://freemusicarchive.org/api/v1/tracks.json?api_key=${encodeURIComponent(apiKey)}&search=${encodeURIComponent(searchQuery(track))}&limit=5`
    );
    // Field names vary slightly across FMA API responses — read defensively.
    const expectedMs = track.durationMs > 0 ? track.durationMs : null;
    let best: { score: number; url: string } | null = null;
    for (const hit of json.dataset ?? []) {
      const url = hit.track_file ?? hit.track_url;
      const hitTitle = hit.title ?? hit.track_title;
      if (!url || !hitTitle) continue;
      const durationSec = hit.duration ?? 0;
      const hitMs = durationSec > 0 ? Math.round(durationSec * 1000) : 0;
      if (
        !validateSearchHit(
          title,
          track.artists[0]?.name ?? '',
          hitTitle,
          hit.artist_name ?? hit.artist,
          hitMs,
          expectedMs
        )
      ) {
        continue;
      }
      const score = hitMs > 0 && expectedMs ? -Math.abs(hitMs - expectedMs) : 0;
      if (!best || score > best.score) best = { score, url };
    }
    if (!best) return null;
    return {
      url: best.url,
      provider: 'fma',
      mimeType: 'audio/mpeg',
      expectedDurationMs: track.durationMs > 45_000 ? track.durationMs : undefined,
    };
  } catch {
    return null;
  }
}
