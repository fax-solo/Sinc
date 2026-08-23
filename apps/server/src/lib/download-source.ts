import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { CanonicalTrack } from '@sinc/shared';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { getEnv } from '../config/env.js';
import { searchTitle } from './track-match.js';
import { probeAudioDurationMs } from './audio-tag.js';
import type { YtdlpResolver, YtdlpProvider } from './ytdlp.js';

export interface DownloadResult {
  provider: string;
  sourceUrl: string;
  filePath: string;
  mimeType: string;
}

export type DownloadProgressFn = (percent: number) => void;

/**
 * Source chain used for offline downloads. Sources are tried in order and the
 * first one that produces a file wins.
 *
 * NOTE: yt-dlp (SoundCloud/YouTube) downloads sit in a legal grey area and are
 * kept first only because they are the most reliable. The rest are license-safe
 * (Creative Commons / public domain).
 */
export const DOWNLOAD_SOURCE_ORDER = [
  'soundcloud',
  'youtube',
  'jamendo',
  'archive',
  'fma',
] as const;

export type DownloadSourceName = (typeof DOWNLOAD_SOURCE_ORDER)[number];

export interface DownloadSourceImpl {
  readonly name: DownloadSourceName;
  download(
    track: CanonicalTrack,
    directUrl: string | undefined,
    stem: string,
    dir: string,
    onProgress: DownloadProgressFn,
    signal?: AbortSignal
  ): Promise<DownloadResult | null>;
}

const SEARCH_QUERY = (track: CanonicalTrack): string =>
  [track.artists[0]?.name, searchTitle(track.title)].filter(Boolean).join(' - ').trim();

const USER_AGENT = 'Sinc/1.0 (+https://sinc.app)';

async function fetchToFile(
  url: string,
  dest: string,
  onProgress: DownloadProgressFn,
  signal?: AbortSignal
): Promise<string> {
  const timeout = AbortSignal.timeout(60_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const res = await fetch(url, {
    signal: combined,
    headers: { 'user-agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);

  const total = Number(res.headers.get('content-length') ?? 0);
  let written = 0;
  const progress = new Writable({
    write(chunk: Buffer, _enc, cb) {
      written += chunk.length;
      if (total > 0) onProgress(Math.min(99, Math.round((written / total) * 100)));
      cb();
    },
  });

  await pipeline(
    Readable.fromWeb(res.body as unknown as WebReadableStream),
    progress,
    createWriteStream(dest)
  );
  onProgress(100);
  return dest;
}

function shortHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).padStart(6, '0').slice(-6);
}

export function safeStem(track: CanonicalTrack): string {
  const raw = `${track.artists[0]?.name ?? 'unknown'}-${track.title}`
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return `${raw || 'track'}-${shortHash(track.id)}`;
}

/** Streams shorter than this are previews (e.g. SoundCloud's 30s samples for
 *  label-owned tracks), never the full song. */
const MIN_FULL_LENGTH_MS = 45_000;

class YtdlpSource implements DownloadSourceImpl {
  constructor(
    readonly name: DownloadSourceName,
    private readonly ytdlp: YtdlpResolver,
    private readonly searchPrefix: 'scsearch' | 'ytsearch',
    private readonly lastResort = false
  ) {}

  private get site(): YtdlpProvider {
    return this.searchPrefix === 'scsearch' ? 'soundcloud' : 'youtube';
  }

  async download(
    track: CanonicalTrack,
    directUrl: string | undefined,
    stem: string,
    dir: string,
    onProgress: DownloadProgressFn,
    signal?: AbortSignal
  ): Promise<DownloadResult | null> {
    const isSoundcloudUrl = /soundcloud\.com/i.test(directUrl ?? '');
    const direct =
      this.name === 'soundcloud'
        ? isSoundcloudUrl
          ? directUrl
          : undefined
        : !isSoundcloudUrl
          ? directUrl
          : undefined;

    if (direct) {
      return this.run(direct, track, stem, dir, onProgress, signal);
    }

    // Strict variant-aware match. SoundCloud search is remix/mashup heavy, so
    // unless a clean match exists we skip it and let the next source (YouTube)
    // try. YouTube acts as last resort to keep obscure downloads working.
    const best = await this.ytdlp.bestMatchUrl(SEARCH_QUERY(track), this.site, {
      title: track.title,
      artist: track.artists[0]?.name,
      durationMs: track.durationMs > 0 ? track.durationMs : null,
    });
    const urlOrQuery =
      best ?? (this.lastResort ? `${this.searchPrefix}1:${SEARCH_QUERY(track)}` : null);
    if (!urlOrQuery) return null;

    return this.run(urlOrQuery, track, stem, dir, onProgress, signal);
  }

  private async run(
    urlOrQuery: string,
    track: CanonicalTrack,
    stem: string,
    dir: string,
    onProgress: DownloadProgressFn,
    signal?: AbortSignal
  ): Promise<DownloadResult | null> {
    try {
      const filePath = await this.ytdlp.download(urlOrQuery, dir, stem, onProgress, signal);

      // SoundCloud serves 30s previews for some tracks; reject anything that
      // is far shorter than the expected song so the chain falls through to
      // the next source instead of shipping a preview as a download.
      const actualMs = await probeAudioDurationMs(filePath);
      const expectedMs = track.durationMs > 0 ? track.durationMs : null;
      if (
        actualMs != null &&
        (actualMs < MIN_FULL_LENGTH_MS ||
          (expectedMs != null && expectedMs >= 90_000 && actualMs < expectedMs * 0.5))
      ) {
        await fs.rm(filePath, { force: true }).catch(() => undefined);
        return null;
      }

      return {
        provider: this.name,
        sourceUrl: urlOrQuery,
        filePath,
        mimeType: 'audio/mpeg',
      };
    } catch {
      return null;
    }
  }
}

class JamendoSource implements DownloadSourceImpl {
  readonly name = 'jamendo' as const;

  async download(
    track: CanonicalTrack,
    _directUrl: string | undefined,
    stem: string,
    dir: string,
    onProgress: DownloadProgressFn,
    signal?: AbortSignal
  ): Promise<DownloadResult | null> {
    const clientId = process.env.JAMENDO_CLIENT_ID;
    if (!clientId) return null;
    try {
      const res = await fetch(
        `https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}&format=json&limit=5&namesearch=${encodeURIComponent(SEARCH_QUERY(track))}&audioformat=mp32`,
        { headers: { 'user-agent': USER_AGENT } }
      );
      const json = (await res.json()) as { results?: Array<{ audio?: string }> };
      const audio = json.results?.[0]?.audio;
      if (!audio) return null;
      const dest = path.join(dir, `${stem}.mp3`);
      await fetchToFile(audio, dest, onProgress, signal);
      return { provider: this.name, sourceUrl: audio, filePath: dest, mimeType: 'audio/mpeg' };
    } catch {
      return null;
    }
  }
}

class InternetArchiveSource implements DownloadSourceImpl {
  readonly name = 'archive' as const;

  async download(
    track: CanonicalTrack,
    _directUrl: string | undefined,
    stem: string,
    dir: string,
    onProgress: DownloadProgressFn,
    signal?: AbortSignal
  ): Promise<DownloadResult | null> {
    const q = encodeURIComponent(`"${track.title}" AND mediatype:audio`);
    try {
      const res = await fetch(
        `https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier&rows=5&output=json`,
        { headers: { 'user-agent': USER_AGENT } }
      );
      const json = (await res.json()) as { response?: { docs?: Array<{ identifier: string }> } };
      const docs = json.response?.docs ?? [];
      for (const doc of docs) {
        try {
          const metaRes = await fetch(`https://archive.org/metadata/${doc.identifier}`, {
            headers: { 'user-agent': USER_AGENT },
          });
          const meta = (await metaRes.json()) as {
            files?: Array<{ name: string; format?: string }>;
          };
          const file = (meta.files ?? []).find(
            (f) =>
              /\.(mp3|ogg)$/i.test(f.name) && (f.format?.toLowerCase().includes('audio') ?? false)
          );
          if (!file) continue;
          const url = `https://archive.org/download/${doc.identifier}/${encodeURIComponent(file.name)}`;
          const ext = path.extname(file.name).toLowerCase() === '.ogg' ? '.ogg' : '.mp3';
          const dest = path.join(dir, `${stem}${ext}`);
          await fetchToFile(url, dest, onProgress, signal);
          return {
            provider: this.name,
            sourceUrl: url,
            filePath: dest,
            mimeType: ext === '.ogg' ? 'audio/ogg' : 'audio/mpeg',
          };
        } catch {
          continue;
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}

class FmaSource implements DownloadSourceImpl {
  readonly name = 'fma' as const;

  async download(
    track: CanonicalTrack,
    _directUrl: string | undefined,
    stem: string,
    dir: string,
    onProgress: DownloadProgressFn,
    signal?: AbortSignal
  ): Promise<DownloadResult | null> {
    const apiKey = process.env.FMA_API_KEY;
    if (!apiKey) return null;
    try {
      const res = await fetch(
        `https://freemusicarchive.org/api/v1/tracks.json?api_key=${apiKey}&search=${encodeURIComponent(SEARCH_QUERY(track))}&limit=5`,
        { headers: { 'user-agent': USER_AGENT } }
      );
      const json = (await res.json()) as {
        dataset?: Array<{ track_title?: string; track_url?: string; track_file?: string }>;
      };
      const item = (json.dataset ?? []).find((t) => t.track_url || t.track_file);
      const url = item?.track_url ?? item?.track_file;
      if (!url) return null;
      const dest = path.join(dir, `${stem}.mp3`);
      await fetchToFile(url, dest, onProgress, signal);
      return { provider: this.name, sourceUrl: url, filePath: dest, mimeType: 'audio/mpeg' };
    } catch {
      return null;
    }
  }
}

/** Builds the ordered source chain. Jamendo/FMA are skipped at runtime unless configured. */
export function buildDownloadSources(ytdlp: YtdlpResolver): DownloadSourceImpl[] {
  return [
    new YtdlpSource('soundcloud', ytdlp, 'scsearch'),
    new YtdlpSource('youtube', ytdlp, 'ytsearch', true),
    new JamendoSource(),
    new InternetArchiveSource(),
    new FmaSource(),
  ];
}

export class DownloadResolver {
  private readonly downloadDir: string;
  private readonly sources: DownloadSourceImpl[];

  constructor(
    ytdlp: YtdlpResolver,
    downloadDir: string = path.resolve(getEnv().DOWNLOAD_DIR),
    sources: DownloadSourceImpl[] = buildDownloadSources(ytdlp)
  ) {
    this.downloadDir = downloadDir;
    this.sources = sources;
  }

  async download(
    track: CanonicalTrack,
    directUrl: string | undefined,
    onProgress: DownloadProgressFn = () => undefined,
    signal?: AbortSignal
  ): Promise<DownloadResult> {
    const dir = path.join(this.downloadDir, 'files');
    await fs.mkdir(dir, { recursive: true });
    const stem = safeStem(track);

    for (const source of this.sources) {
      const result = await source.download(track, directUrl, stem, dir, onProgress, signal);
      if (result) return result;
    }
    throw new Error('All download sources failed');
  }
}
