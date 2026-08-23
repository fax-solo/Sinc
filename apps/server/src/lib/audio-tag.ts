/**
 * MP3 tagging via ffmpeg. After yt-dlp produces the audio file we stamp it
 * with ID3v2 metadata (title/artist/album) and embed the cover art, so the
 * file shows up complete in music players when published to the device's
 * Music folder. Best-effort: any failure keeps the untagged file.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface Mp3Tags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  artworkUrl?: string | null;
}

const ARTWORK_TIMEOUT_MS = 8_000;
const FFMPEG_TIMEOUT_MS = 30_000;

/** Actual audio duration in ms, or null when it cannot be determined. */
export async function probeAudioDurationMs(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(
      'ffprobe',
      ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    let out = '';
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        resolve(null);
      }
    }, 10_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    });
    child.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const seconds = Number(out.trim().split('\n').pop());
        resolve(Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null);
      }
    });
  });
}

async function fetchArtwork(
  url: string | null | undefined,
  destDir: string
): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ARTWORK_TIMEOUT_MS) });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) return null;
    const ext = contentType.includes('png') ? '.png' : '.jpg';
    const buf = Buffer.from(await res.arrayBuffer());
    // Sanity-check magic bytes: some CDNs answer errors with 200 + HTML/JSON.
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    if ((!isJpeg && !isPng) || buf.length > 8 * 1024 * 1024) return null;
    const coverPath = path.join(destDir, `cover${ext}`);
    await fs.writeFile(coverPath, buf);
    return coverPath;
  } catch {
    return null;
  }
}

function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn('ffmpeg', args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        resolve(false);
      }
    }, FFMPEG_TIMEOUT_MS);
    child.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(false);
      }
    });
    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(code === 0);
      }
    });
  });
}

/** Some download sources save non-MP3 bytes under an .mp3 name (Jamendo/FMA/
 *  Internet Archive serve AAC or Vorbis). Copy is only safe for real MP3. */
async function audioCodecIsMp3(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(
      'ffprobe',
      [
        '-v',
        'quiet',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_name',
        '-of',
        'csv=p=0',
        filePath,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    let out = '';
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        resolve(false);
      }
    }, 10_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(false);
      }
    });
    child.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(out.trim() === 'mp3');
      }
    });
  });
}

/** True when the file's ID3 tags carry a title (i.e. it was tagged before). */
export async function hasId3Title(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(
      'ffprobe',
      ['-v', 'quiet', '-show_entries', 'format_tags=title', '-of', 'csv=p=0', filePath],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    let out = '';
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        resolve(false);
      }
    }, 10_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(false);
      }
    });
    child.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(out.trim().length > 0);
      }
    });
  });
}

/** Writes ID3 tags (+ embedded cover when available) onto `filePath` in place. */
export async function tagMp3(filePath: string, tags: Mp3Tags): Promise<boolean> {
  // The scratch dir MUST live on the same filesystem as the target file:
  // os.tmpdir() is often a different mount, and rename() across mounts
  // fails with EXDEV.
  const destDir = path.join(
    path.dirname(filePath),
    `.sinc-tag-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  await fs.mkdir(destDir, { recursive: true });
  const outPath = path.join(destDir, 'tagged.mp3');
  try {
    const coverPath = await fetchArtwork(tags.artworkUrl, destDir);
    const isMp3 = await audioCodecIsMp3(filePath);

    const args = ['-y', '-i', filePath];
    if (coverPath) args.push('-i', coverPath);
    // Audio always maps; the cover maps only when one was actually fetched
    // ("-map '1?'" does NOT tolerate a wholly missing input file).
    args.push('-map', '0:a');
    if (coverPath) args.push('-map', '1:v', '-c:v', 'copy');
    args.push('-c:a', isMp3 ? 'copy' : 'libmp3lame');
    if (!isMp3) args.push('-b:a', '192k');
    args.push('-id3v2_version', '3');
    if (tags.title) args.push('-metadata', `title=${tags.title}`);
    if (tags.artist) args.push('-metadata', `artist=${tags.artist}`);
    if (tags.album) args.push('-metadata', `album=${tags.album}`);
    if (tags.albumArtist) args.push('-metadata', `album_artist=${tags.albumArtist}`);
    // Marks the mapped image stream as embedded front cover (APIC in ID3).
    if (coverPath) args.push('-disposition:v', 'attached_pic');
    args.push(outPath);

    const ok = await runFfmpeg(args);
    if (!ok) return false;
    const tagged = await fs
      .stat(outPath)
      .then((s) => s.size > 0)
      .catch(() => false);
    if (!tagged) return false;
    await fs.rename(outPath, filePath);
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(destDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
