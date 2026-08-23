/**
 * YouTube auto-caption lyrics fallback. LRCLIB covers most tracks, but niche
 * songs — especially Arabic ones — are frequently missing there. YouTube's
 * auto-generated captions for the *matching* video (resolved with the same
 * variant-aware matching used for playback/download) provide synced lyrics as
 * a last resort.
 */
import type { CanonicalTrack } from '@sinc/shared';
import { searchTitle } from './track-match.js';
import type { YtdlpResolver } from './ytdlp.js';
import type { LyricsProvider, RawLyrics } from './lyrics.js';

/** Instrumental/placeholder markers the auto-captions sprinkle around verses. */
const PLACEHOLDER_RE = /[[(]?(موسيقى|تشغيل الموسيقى|music|♪|instrumental|applause)[\])]?/gi;

const LRC_TS = /^\[(?:\d{1,3}:)?(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]+/;

function timestampMs(bracket: string): number {
  const m = bracket.match(LRC_TS);
  if (!m) return 0;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  const ms = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) : 0;
  return min * 60_000 + sec * 1000 + ms;
}

/**
 * Strips `[re:...]`/`[ve:...]` metadata, drops placeholder lines and removes
 * inline `[موسيقى]`/`♪` fragments that auto-captions interleave with lyrics.
 * Auto-captions re-emit each phrase at the start of the next segment, so
 * consecutive duplicate texts inside a ~6s window are collapsed.
 */
export function cleanCaptionLrc(lrc: string): string {
  const out: string[] = [];
  let lastText = '';
  let lastTs = -Infinity;
  for (const raw of lrc.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\[(re|ve|ti|ar|al|by|offset):/i.test(line)) continue;

    const tsMatch = line.match(LRC_TS);
    const text = (tsMatch ? line.slice(tsMatch[0].length) : line)
      .replace(PLACEHOLDER_RE, ' ')
      .trim();
    if (!text) continue;

    const ts = tsMatch ? timestampMs(tsMatch[0]) : 0;
    const isDuplicateFrame =
      text === lastText && (tsMatch ? ts - lastTs < 6000 : lastTs !== -Infinity);
    if (isDuplicateFrame) continue;

    lastText = text;
    if (tsMatch) lastTs = ts;
    out.push(`${tsMatch?.[0] ?? ''}${text}`);
  }
  return out.join('\n');
}

export class YoutubeCaptionsProvider implements LyricsProvider {
  readonly name = 'youtube-captions';

  constructor(private readonly ytdlp: YtdlpResolver) {}

  async fetchLyrics(track: CanonicalTrack): Promise<RawLyrics | null> {
    const query = [track.artists[0]?.name, searchTitle(track.title)]
      .filter((s) => s && s.trim())
      .join(' - ')
      .trim();
    if (!query) return null;

    const url = await this.ytdlp.bestMatchUrl(query, 'youtube', {
      title: track.title,
      artist: track.artists[0]?.name,
      durationMs: track.durationMs > 0 ? track.durationMs : null,
    });
    if (!url) return null;

    const lrc = await this.ytdlp.fetchCaptions(url);
    if (!lrc) return null;

    const cleaned = cleanCaptionLrc(lrc);
    if (!cleaned) return null;
    return { synced: cleaned, plain: null, language: null };
  }
}
