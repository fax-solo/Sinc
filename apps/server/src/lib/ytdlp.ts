import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getEnv } from '../config/env.js';
import { pickBestMatch, searchTitle, type MatchQuery } from './track-match.js';

export type YtdlpProvider = 'soundcloud' | 'youtube';

export interface ResolvedStream {
  url: string;
  provider: YtdlpProvider;
  mimeType: string;
  durationMs?: number;
}

/** Streams shorter than this are treated as previews and skipped. */
const MIN_FULL_LENGTH_MS = 45_000;

export interface YtdlpSearchResult {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  artworkUrl?: string;
  url: string;
  provider: YtdlpProvider;
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** FIFO gate bounding how many yt-dlp child processes run at once. Each
 *  spawn costs real CPU/network, so an unbounded burst of track lookups
 *  would otherwise starve the box and slow every caller. */
class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }
    return new Promise((release) => {
      this.queue.push(() => {
        this.active += 1;
        release(() => this.release());
      });
    });
  }

  private release(): void {
    this.active -= 1;
    this.queue.shift()?.();
  }
}

/** Tiny TTL memo for resolver lookups. Stream URLs expire upstream, so
 *  resolved streams are only trusted briefly; metadata/search results live
 *  longer. Negative results are cached too (shorter) to blunt retry storms. */
class LookupCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();
  private static MAX_ENTRIES = 512;

  async wrap<T>(
    key: string,
    ttlMs: number,
    missTtlMs: number,
    compute: () => Promise<T>
  ): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
    const value = await compute();
    const ttl = value == null ? missTtlMs : ttlMs;
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
    if (this.store.size > LookupCache.MAX_ENTRIES) {
      const now = Date.now();
      for (const [k, entry] of this.store) {
        if (entry.expiresAt <= now) this.store.delete(k);
      }
      while (this.store.size > LookupCache.MAX_ENTRIES) {
        this.store.delete(this.store.keys().next().value as string);
      }
    }
    return value;
  }
}

const SEARCH_PREFIX: Record<YtdlpProvider, string> = {
  soundcloud: 'scsearch',
  youtube: 'ytsearch',
};

/** The default `android_vr` client intermittently returns 403 on media fetches. */
const YOUTUBE_CLIENT_ARGS = ['--extractor-args', 'youtube:player_client=android'];

function youtubeClientArgs(urlOrQuery: string): string[] {
  return /youtube|ytsearch|googlevideo/i.test(urlOrQuery) ? YOUTUBE_CLIENT_ARGS : [];
}

function mimeForExt(ext: string | undefined): string {
  switch ((ext ?? '').toLowerCase()) {
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
    case 'mp4':
      return 'audio/mp4';
    case 'opus':
    case 'ogg':
      return 'audio/ogg';
    case 'webm':
      return 'audio/webm';
    default:
      return 'application/octet-stream';
  }
}

export function encodeTrackId(url: string): string {
  return `ytdlp:${Buffer.from(url).toString('base64url')}`;
}

export function decodeTrackId(id: string): string | null {
  if (!id.startsWith('ytdlp:')) return null;
  try {
    return Buffer.from(id.slice('ytdlp:'.length), 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

export function isYtdlpId(id: string): boolean {
  return id.startsWith('ytdlp:');
}

export function providerForUrl(url: string): YtdlpProvider {
  return url.toLowerCase().includes('soundcloud.com') ? 'soundcloud' : 'youtube';
}

/** Converts a WebVTT caption document into a minimal LRC document. */
function vttToLrc(vtt: string): string {
  const lines: string[] = [];
  const cueRe = /(\d{2}):(\d{2}):(\d{2}\.\d{3})\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/;
  let start: number | null = null;
  let cueLines: string[] = [];
  const flush = () => {
    if (start === null || cueLines.length === 0) return;
    const min = Math.floor(start / 60_000);
    const sec = Math.floor((start % 60_000) / 1000);
    const ms = start % 1000;
    lines.push(
      `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}]${cueLines.join(' ').trim()}`
    );
    cueLines = [];
  };
  for (const raw of vtt.split(/\r?\n/)) {
    const m = raw.match(cueRe);
    if (m) {
      flush();
      start =
        Number(m[1]) * 3_600_000 + Number(m[2]) * 60_000 + Math.round(parseFloat(m[3]) * 1000);
      continue;
    }
    const t = raw.trim();
    if (
      t &&
      !t.startsWith('WEBVTT') &&
      !/^Kind:|^Language:|^NOTE|^Style|^Region|^\d+$/.test(t) &&
      !t.startsWith('-->')
    ) {
      cueLines.push(t);
    }
  }
  flush();
  return lines.join('\n');
}

export class YtdlpResolver {
  private binary: string;
  private availableCache: boolean | null = null;
  /** Metadata/resolve/search child processes. */
  private lookupGate = new Semaphore(3);
  /** Full audio downloads are heavier; fewer at once. */
  private downloadGate = new Semaphore(2);
  private cache = new LookupCache();

  constructor() {
    this.binary = getEnv().YTDLP_BINARY;
  }

  isAvailable(): boolean {
    if (this.availableCache !== null) return this.availableCache;
    try {
      const res = spawnSync(this.binary, ['--version'], { timeout: 5000, stdio: 'ignore' });
      this.availableCache = res.status === 0;
    } catch {
      this.availableCache = false;
    }
    return this.availableCache;
  }

  private async run(args: string[], timeoutMs = 60_000): Promise<RunResult> {
    const release = await this.lookupGate.acquire();
    try {
      return await new Promise<RunResult>((resolve) => {
        const child = spawn(this.binary, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            child.kill('SIGKILL');
            resolve({ stdout, stderr: stderr + '\n(yt-dlp timed out)', code: -1 });
          }
        }, timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        child.on('error', (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ stdout, stderr: stderr + `\n${err.message}`, code: -1 });
          }
        });
        child.on('close', (code) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ stdout, stderr, code: code ?? -1 });
          }
        });
      });
    } finally {
      release();
    }
  }

  async searchTracks(
    query: string,
    limit = 10,
    site: YtdlpProvider = 'soundcloud'
  ): Promise<YtdlpSearchResult[]> {
    const count = Math.max(1, Math.min(limit, 50));
    const searchQuery = `${SEARCH_PREFIX[site]}${count}:${query}`;
    const { stdout, code } = await this.run(
      ['--flat-playlist', '--dump-single-json', '--no-warnings', '--no-playlist', searchQuery],
      30_000
    );
    if (code !== 0) return [];

    try {
      const data = JSON.parse(stdout) as { entries?: Array<Record<string, unknown>> };
      const entries = data.entries ?? [];
      const results: YtdlpSearchResult[] = [];
      for (const entry of entries) {
        const title = String(entry.title ?? '').trim();
        const url = String(entry.webpage_url ?? entry.url ?? '').trim();
        if (!title || !url) continue;
        results.push({
          id: encodeTrackId(url),
          title,
          artist: String(entry.uploader ?? entry.channel ?? 'Unknown Artist'),
          durationMs: Math.max(0, Number(entry.duration ?? 0) * 1000),
          artworkUrl: entry.thumbnail ? String(entry.thumbnail) : undefined,
          url,
          provider: site,
        });
      }
      return results;
    } catch {
      return [];
    }
  }

  /** Resolved stream URLs expire upstream (~hours), so trust them briefly. */
  async resolve(urlOrQuery: string): Promise<ResolvedStream | null> {
    return this.cache.wrap(`resolve:${urlOrQuery}`, 20 * 60_000, 5 * 60_000, () =>
      this.resolveUncached(urlOrQuery)
    );
  }

  private async resolveUncached(urlOrQuery: string): Promise<ResolvedStream | null> {
    const { stdout, code } = await this.run(
      [
        '--no-warnings',
        '--no-playlist',
        ...youtubeClientArgs(urlOrQuery),
        '-f',
        'bestaudio/best',
        '--print',
        '%(url)s\t%(ext)s\t%(duration)s',
        urlOrQuery,
      ],
      60_000
    );
    if (code !== 0) return null;

    const line = stdout.split('\n').find((l) => l.includes('\t')) ?? stdout.trim();
    const [url, ext, duration] = line.split('\t');
    if (!url || !/^https?:\/\//.test(url)) return null;

    const lower = url.toLowerCase();
    const provider: YtdlpProvider = lower.includes('soundcloud.com') ? 'soundcloud' : 'youtube';
    const durationMs = Number(duration);
    return {
      url,
      provider,
      mimeType: mimeForExt(ext),
      durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs * 1000 : undefined,
    };
  }

  async getTrackInfo(url: string): Promise<YtdlpSearchResult | null> {
    return this.cache.wrap(`info:${url}`, 60 * 60_000, 5 * 60_000, () =>
      this.getTrackInfoUncached(url)
    );
  }

  private async getTrackInfoUncached(url: string): Promise<YtdlpSearchResult | null> {
    const { stdout, code } = await this.run(
      ['--no-warnings', '--no-playlist', '--dump-single-json', url],
      30_000
    );
    if (code !== 0) return null;
    try {
      const data = JSON.parse(stdout) as {
        title?: string;
        uploader?: string;
        channel?: string;
        duration?: number;
        thumbnail?: string;
        webpage_url?: string;
      };
      const title = String(data.title ?? '').trim();
      if (!title) return null;
      return {
        id: encodeTrackId(data.webpage_url ?? url),
        title,
        artist: String(data.uploader ?? data.channel ?? 'Unknown Artist'),
        durationMs: Math.max(0, Number(data.duration ?? 0) * 1000),
        artworkUrl: data.thumbnail ? String(data.thumbnail) : undefined,
        url: data.webpage_url ?? url,
        provider: providerForUrl(url),
      };
    } catch {
      return null;
    }
  }

  /**
   * Searches a site for the requested track and returns the URL of the best
   * matching upload, or `null` when no candidate clears the match threshold
   * (e.g. every result is a remix/mashup). Returns `null` too when the site
   * returned no search results, so callers can move to the next source.
   */
  async bestMatchUrl(
    query: string,
    site: YtdlpProvider,
    matchQuery: MatchQuery
  ): Promise<string | null> {
    // Search results (page URLs, not stream URLs) stay valid much longer.
    return this.cache.wrap(`match:${site}:${query}`, 60 * 60_000, 5 * 60_000, async () => {
      const results = await this.searchTracks(query, 8, site);
      if (results.length === 0) return null;
      const best = pickBestMatch(
        matchQuery,
        results.map((r) => ({ ...r, ref: r.url }))
      );
      return best ? (best.candidate.ref as string) : null;
    });
  }

  async resolveByQuery(
    artist: string,
    title: string,
    durationMs?: number | null
  ): Promise<ResolvedStream | null> {
    const query = [artist, searchTitle(title)]
      .filter((s) => s && s.trim())
      .join(' - ')
      .trim();
    if (!query) return null;

    const matchQuery: MatchQuery = { title, artist, durationMs: durationMs ?? null };
    for (const site of ['soundcloud', 'youtube'] as YtdlpProvider[]) {
      const url = await this.bestMatchUrl(query, site, matchQuery);
      if (!url) continue;
      const stream = await this.resolve(url);
      if (!stream) continue;
      // SoundCloud serves 30s previews for label-owned tracks when unauthenticated.
      if (
        site === 'soundcloud' &&
        stream.durationMs != null &&
        stream.durationMs < MIN_FULL_LENGTH_MS
      ) {
        continue;
      }
      return stream;
    }

    // Last resort: the plain top YouTube result keeps playback working for
    // obscure titles where nothing cleared the match threshold.
    return this.resolve(`${SEARCH_PREFIX.youtube}1:${query}`);
  }

  /**
   * Downloads subtitles/auto-captions for a video URL and returns them as an
   * LRC document (converted via ffmpeg when available, otherwise parsed from
   * VTT). Used as a lyrics fallback for tracks missing from lyrics databases —
   * YouTube auto-captions cover Arabic and most other languages. Returns
   * `null` on any failure.
   */
  async fetchCaptions(
    url: string,
    langPriority: string[] = ['ar.*', 'en.*']
  ): Promise<string | null> {
    const destDir = path.join(
      os.tmpdir(),
      `sinc-caps-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    await fs.mkdir(destDir, { recursive: true });
    try {
      for (const lang of langPriority) {
        const lrc = await this.fetchCaptionsForLang(url, destDir, lang);
        if (lrc) return lrc;
      }
      return null;
    } finally {
      await fs.rm(destDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async fetchCaptionsForLang(
    url: string,
    destDir: string,
    lang: string
  ): Promise<string | null> {
    const tag = `subs-${lang.replace(/[^\p{L}\p{N}]+/gu, '_')}`;
    const { code } = await this.run(
      [
        '--no-warnings',
        '--no-playlist',
        ...youtubeClientArgs(url),
        '--skip-download',
        '--write-subs',
        '--write-auto-subs',
        '--sub-format',
        'vtt',
        '--convert-subs',
        'lrc',
        '--sub-langs',
        lang,
        '-o',
        path.join(destDir, `${tag}.%(ext)s`),
        url,
      ],
      60_000
    );
    // yt-dlp exits non-zero when a sibling language 429s even if this one
    // downloaded fine, so judge by the files produced, not the exit code.
    void code;

    const files = (await fs.readdir(destDir)).filter((f) => f.startsWith(tag));
    const lrc = files.find((f) => f.endsWith('.lrc'));
    if (lrc) {
      const content = await fs.readFile(path.join(destDir, lrc), 'utf8');
      return content.trim() || null;
    }
    const vtt = files.find((f) => f.endsWith('.vtt'));
    if (vtt) {
      const content = await fs.readFile(path.join(destDir, vtt), 'utf8');
      const lrcContent = vttToLrc(content);
      return lrcContent || null;
    }
    return null;
  }

  async download(
    directUrl: string,
    destDir: string,
    filename: string,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal
  ): Promise<string> {
    await fs.mkdir(destDir, { recursive: true });
    const outputTemplate = path.join(destDir, `${filename}.%(ext)s`);
    const release = await this.downloadGate.acquire();

    try {
      return await new Promise<string>((resolve, reject) => {
        const child = spawn(
          this.binary,
          [
            '--no-warnings',
            '--no-playlist',
            ...youtubeClientArgs(directUrl),
            '-f',
            'bestaudio/best',
            '-x',
            '--audio-format',
            'mp3',
            '--audio-quality',
            '0',
            '--retries',
            '5',
            '--fragment-retries',
            '5',
            '--socket-timeout',
            '30',
            '--newline',
            '-o',
            outputTemplate,
            directUrl,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } }
        );

        let stderr = '';
        let settled = false;
        let aborted = false;

        const abort = () => {
          if (!aborted) {
            aborted = true;
            child.kill('SIGTERM');
          }
        };
        if (signal) {
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        }

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            child.kill('SIGKILL');
            reject(new Error('Download timed out'));
          }
        }, 90_000);

        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
          const match = stderr.match(/\[download\]\s+(\d+(?:\.\d+)?)%/g);
          if (match && onProgress) {
            const last = match[match.length - 1];
            const pct = Number(last?.replace(/[^0-9.]/g, ''));
            if (Number.isFinite(pct)) onProgress(Math.min(99, pct));
          }
        });
        child.on('error', () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error('Failed to launch yt-dlp'));
          }
        });
        child.on('close', async (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          if (aborted) {
            reject(new Error('Aborted'));
            return;
          }
          if (code !== 0) {
            reject(new Error(stderr.trim().split('\n').pop()?.slice(0, 300) || 'Download failed'));
            return;
          }
          const candidate = path.join(destDir, `${filename}.mp3`);
          try {
            await fs.access(candidate);
            onProgress?.(100);
            resolve(candidate);
          } catch {
            reject(new Error('Download failed: output file not found'));
          }
        });
      });
    } finally {
      release();
    }
  }
}
