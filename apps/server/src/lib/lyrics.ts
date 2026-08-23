/**
 * Lyrics resolution. A small provider chain (LRCLIB first) resolves synced
 * (LRC) or plain-text lyrics for a track. Results are persisted in the `Lyric`
 * table keyed by track id so repeated lookups are served from the cache and
 * downloads can bundle lyrics for offline playback.
 */
import type { CanonicalTrack, LyricLine, TrackLyrics } from '@sinc/shared';
import { prisma } from './prisma.js';
import { pickBestMatch } from './track-match.js';

export interface RawLyrics {
  synced: string | null;
  plain: string | null;
  language?: string | null;
}

export interface LyricsProvider {
  readonly name: string;
  fetchLyrics(track: CanonicalTrack): Promise<RawLyrics | null>;
}

const LRC_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** A lyric line repeated on consecutive timed entries within this window is
 *  a provider artifact (auto-captions re-emit each phrase at the start of the
 *  next segment ~3s later, LRCLIB occasionally mirrors a line). Collapsing it
 *  keeps the highlight honest without dropping legitimate far-apart repeats. */
const DEDUP_WINDOW_MS = 6000;

export interface ParsedLrc {
  synced: boolean;
  lines: LyricLine[];
}

/** Parses an LRC document into timed lines (falls back to plain text). */
export function parseLrc(lrc: string): ParsedLrc {
  const lines = lrc.split(/\r?\n/);
  const timed: LyricLine[] = [];
  const plainParts: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const times: number[] = [];
    LRC_TAG.lastIndex = 0;
    let match: RegExpExecArray | null;
    let tagEnd = 0;
    while ((match = LRC_TAG.exec(line)) !== null) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const fracRaw = match[3] ?? '0';
      const frac = parseInt(fracRaw.padEnd(3, '0').slice(0, 3), 10);
      times.push(min * 60_000 + sec * 1000 + frac);
      tagEnd = match.index + match[0].length;
    }
    if (times.length > 0) {
      const text = line.slice(tagEnd).trim();
      if (text) {
        for (const t of times) timed.push({ timeMs: t, text });
      }
    } else {
      plainParts.push(line);
    }
  }

  timed.sort((a, b) => a.timeMs - b.timeMs);

  const deduped: LyricLine[] = [];
  let lastText = '';
  let lastMs = -Infinity;
  for (const line of timed) {
    const repeated =
      line.text === lastText &&
      (line.text.length > 0 ? line.timeMs - lastMs < DEDUP_WINDOW_MS : false);
    if (repeated) continue;
    lastText = line.text;
    lastMs = line.timeMs;
    deduped.push(line);
  }

  if (deduped.length >= 1) {
    return { synced: true, lines: deduped };
  }
  const text = plainParts.length > 0 ? plainParts.join('\n') : lrc.trim();
  return { synced: false, lines: text ? [{ timeMs: 0, text }] : [] };
}

/** Serializes timed lines back into an LRC document for storage. */
export function serializeLrc(lines: LyricLine[]): string {
  return lines
    .map((l) => {
      const min = Math.floor(l.timeMs / 60_000);
      const sec = Math.floor((l.timeMs % 60_000) / 1000);
      const ms = l.timeMs % 1000;
      return `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}]${l.text}`;
    })
    .join('\n');
}

interface LrclibResponse {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  language?: string | null;
}

interface LrclibSearchItem extends LrclibResponse {
  id: number;
  trackName?: string;
  artistName?: string;
  albumName?: string | null;
  duration?: number;
  instrumental?: boolean;
}

function fromLrclib(json: LrclibResponse): RawLyrics | null {
  if (!json.syncedLyrics && !json.plainLyrics) return null;
  return {
    synced: json.syncedLyrics ?? null,
    plain: json.plainLyrics ?? null,
    language: json.language ?? null,
  };
}

/** LRCLIB — free, no API key, offers synced + plain lyrics. */
export class LrclibProvider implements LyricsProvider {
  readonly name = 'lrclib';

  private async get(track: CanonicalTrack, withDuration: boolean): Promise<LrclibResponse | null> {
    const url = new URL('https://lrclib.net/api/get');
    url.searchParams.set('track_name', track.title);
    url.searchParams.set('artist_name', track.artists.map((a) => a.name).join(', '));
    if (track.album?.title) url.searchParams.set('album_name', track.album.title);
    if (withDuration && track.durationMs > 0) {
      url.searchParams.set('duration', String(Math.round(track.durationMs / 1000)));
    }

    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Sinc/1.0 (music player)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as LrclibResponse;
  }

  private async search(track: CanonicalTrack): Promise<RawLyrics | null> {
    const url = new URL('https://lrclib.net/api/search');
    url.searchParams.set('track_name', track.title);
    url.searchParams.set('artist_name', track.artists.map((a) => a.name).join(', '));

    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Sinc/1.0 (music player)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const items = (await res.json()) as LrclibSearchItem[];
    if (!Array.isArray(items) || items.length === 0) return null;

    const best = pickBestMatch(
      {
        title: track.title,
        artist: track.artists[0]?.name,
        durationMs: track.durationMs > 0 ? track.durationMs : null,
      },
      items.map((item) => ({
        title: item.trackName ?? '',
        artist: item.artistName,
        durationMs: (item.duration ?? 0) * 1000,
        ref: item,
      }))
    );
    const hit = best?.candidate.ref as LrclibSearchItem | undefined;
    if (!hit) return null;
    if (!hit.syncedLyrics && !hit.plainLyrics) return null;
    return {
      synced: hit.syncedLyrics ?? null,
      plain: hit.plainLyrics ?? null,
      language: hit.language ?? null,
    };
  }

  async fetchLyrics(track: CanonicalTrack): Promise<RawLyrics | null> {
    // 1) Exact match (metadata including duration). Most precise.
    const exact = await this.get(track, true).catch(() => null);
    if (exact) return fromLrclib(exact);

    // 2) Some DB rows have a slightly different duration — retry without it.
    const noDuration = await this.get(track, false).catch(() => null);
    if (noDuration) return fromLrclib(noDuration);

    // 3) Search and pick the closest variant-aware candidate.
    return this.search(track).catch(() => null);
  }
}

interface LyricRow {
  trackId: string;
  source: string;
  synced: boolean;
  content: string;
  language: string | null;
}

function fromRow(row: LyricRow): TrackLyrics {
  if (!row.synced) {
    return {
      trackId: row.trackId,
      provider: row.source,
      synced: false,
      language: row.language,
      lines: [],
      plain: row.content || undefined,
    };
  }
  const parsed = parseLrc(row.content);
  return {
    trackId: row.trackId,
    provider: row.source,
    synced: true,
    language: row.language,
    lines: parsed.lines,
  };
}

export class LyricsService {
  constructor(private readonly providers: LyricsProvider[] = [new LrclibProvider()]) {}

  async getLyrics(track: CanonicalTrack): Promise<TrackLyrics> {
    const cached = await prisma.lyric.findUnique({ where: { trackId: track.id } });
    if (cached) return fromRow(cached);

    for (const provider of this.providers) {
      let raw: RawLyrics | null = null;
      try {
        raw = await provider.fetchLyrics(track);
      } catch {
        // Try the next provider.
      }
      if (!raw) continue;

      const parsed = raw.synced
        ? parseLrc(raw.synced)
        : raw.plain
          ? parseLrc(raw.plain)
          : { synced: false, lines: [] as LyricLine[] };
      const row = await prisma.lyric.upsert({
        where: { trackId: track.id },
        update: {},
        create: {
          trackId: track.id,
          title: track.title,
          artist: track.artists.map((a) => a.name).join(', '),
          source: provider.name,
          synced: parsed.synced,
          content: parsed.synced ? serializeLrc(parsed.lines) : (parsed.lines[0]?.text ?? ''),
          language: raw.language ?? null,
        },
      });
      return fromRow(row);
    }

    // Cache a "none" result so we stop hammering providers for missing lyrics.
    const none = await prisma.lyric.upsert({
      where: { trackId: track.id },
      update: {},
      create: {
        trackId: track.id,
        title: track.title,
        artist: track.artists.map((a) => a.name).join(', '),
        source: 'none',
        synced: false,
        content: '',
      },
    });
    return fromRow(none);
  }

  /** Best-effort warm-up so a download bundles lyrics without blocking. */
  async warmTrack(track: CanonicalTrack): Promise<void> {
    await this.getLyrics(track).catch(() => undefined);
  }
}
