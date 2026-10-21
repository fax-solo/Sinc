/**
 * JS-facing yt-dlp resolver. Talks to the native SincYt module (bundled yt-dlp
 * binary + static ffmpeg). Until the Kotlin side is linked, calls surface a
 * clear `YtUnavailableError` so downloads/streaming can degrade gracefully.
 * Mirrors the server's `ytdlp.ts` stream+search rules.
 */
import type { PlaybackSource } from '../../api/music';
import { nativeBridge } from '../native';

export const MIN_FULL_LENGTH_MS = 45_000;

export class YtUnavailableError extends Error {
  constructor() {
    super('The on-device yt-dlp module is not available');
    this.name = 'YtUnavailableError';
  }
}

function mimeForExt(ext: string): string {
  switch (ext) {
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

export function providerForUrl(url: string): string {
  return url.includes('soundcloud.com') ? 'soundcloud' : 'youtube';
}

function ensureYt() {
  if (!nativeBridge.yt.available()) throw new YtUnavailableError();
  return nativeBridge.yt;
}

/** Builds the query used for search-based resolution/downloads. */
export function searchQueryFor(artist: string, title: string): string {
  return `${artist} - ${title}`;
}

/** Resolves a concrete media/page url to a stable stream source. */
export async function resolveStream(url: string): Promise<PlaybackSource> {
  const yt = ensureYt();
  const stream = await yt.resolveStream(url);
  if (stream.durationMs > 0 && stream.durationMs < MIN_FULL_LENGTH_MS) {
    throw new Error('This source looks like a short preview; skipping');
  }
  return {
    uri: stream.uri,
    mimeType: mimeForExt(stream.ext),
    quality: 'high',
    provider: providerForUrl(url),
  };
}

/**
 * Finds the best stream for "artist - title", trying SoundCloud first then
 * YouTube, with a plain YouTube top result as the final fallback.
 */
export async function resolveByQuery(
  artist: string,
  title: string,
  durationMs: number | null
): Promise<PlaybackSource> {
  const yt = ensureYt();
  const url = await yt.resolveByQuery(artist, title, durationMs);
  if (!url) throw new Error('No playable source found');
  const stream = await yt.resolveStream(url);
  if (stream.durationMs > 0 && stream.durationMs < MIN_FULL_LENGTH_MS) {
    throw new Error('Only a short preview was found');
  }
  return {
    uri: stream.uri,
    mimeType: mimeForExt(stream.ext),
    quality: 'high',
    provider: providerForUrl(url),
  };
}
