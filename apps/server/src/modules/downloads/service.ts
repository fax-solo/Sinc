import fs from 'node:fs/promises';
import path from 'node:path';
import type { CanonicalTrack } from '@sinc/shared';
import type { DownloadResolver } from '../../lib/download-source.js';
import type { LyricsService } from '../../lib/lyrics.js';
import { decodeTrackId, isYtdlpId } from '../../lib/ytdlp.js';
import { prisma } from '../../lib/prisma.js';
import { tagMp3, hasId3Title } from '../../lib/audio-tag.js';
import { NotFoundError } from '@sinc/shared';

/** Hard cap for a full source-chain run (search + download + fallbacks). */
const DOWNLOAD_MAX_MS = 9 * 60_000;

function resolvedUrl(directUrl: string | undefined, track: CanonicalTrack): string | undefined {
  return directUrl ?? (isYtdlpId(track.id) ? (decodeTrackId(track.id) ?? undefined) : undefined);
}

export interface DownloadJobDto {
  id: string;
  trackId: string;
  trackTitle: string;
  trackArtist: string;
  trackArtwork?: string | null;
  quality: string;
  status: string;
  progress: number;
  bytesDownloaded: number;
  bytesTotal?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  provider?: string | null;
  sourceUrl?: string | null;
  localPath?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

function toDto(row: {
  id: string;
  trackId: string;
  trackTitle: string;
  trackArtist: string;
  trackArtwork: string | null;
  quality: string;
  status: string;
  progress: number;
  bytesDownloaded: bigint;
  bytesTotal: bigint | null;
  errorCode: string | null;
  errorMessage: string | null;
  provider: string | null;
  sourceUrl: string | null;
  localPath: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}): DownloadJobDto {
  return {
    id: row.id,
    trackId: row.trackId,
    trackTitle: row.trackTitle,
    trackArtist: row.trackArtist,
    trackArtwork: row.trackArtwork,
    quality: row.quality,
    status: row.status,
    progress: row.progress,
    bytesDownloaded: Number(row.bytesDownloaded),
    bytesTotal: row.bytesTotal == null ? null : Number(row.bytesTotal),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    provider: row.provider,
    sourceUrl: row.sourceUrl,
    localPath: row.localPath,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export class DownloadsService {
  /** Files already probed for tags this process, to avoid repeat ffprobe calls. */
  private tagChecked = new Set<string>();

  constructor(
    private readonly resolver: DownloadResolver,
    private readonly lyrics?: LyricsService
  ) {}

  /**
   * Tags a file that predates the tagging step (downloads completed before
   * ID3 stamping existed would otherwise stay bare forever, because
   * startDownload short-circuits on completed jobs). Runs at most once per
   * file per process.
   */
  private async ensureTagged(
    jobId: string,
    filePath: string | null,
    tags: { title: string; artist: string; album?: string; artworkUrl?: string | null }
  ): Promise<void> {
    if (!filePath || this.tagChecked.has(filePath)) return;
    this.tagChecked.add(filePath);
    try {
      if (await hasId3Title(filePath)) return;
      await tagMp3(filePath, {
        title: tags.title,
        artist: tags.artist,
        album: tags.album,
        artworkUrl: tags.artworkUrl,
      });
      await prisma.downloadJob
        .update({ where: { id: jobId }, data: { trackArtwork: tags.artworkUrl ?? null } })
        .catch(() => undefined);
    } catch {
      // Best-effort.
    }
  }

  async startDownload(
    userId: string,
    track: CanonicalTrack,
    directUrl?: string
  ): Promise<DownloadJobDto> {
    const existing = await prisma.downloadJob.findFirst({
      where: { userId, trackId: track.id, status: { in: ['downloading', 'completed'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      // A `downloading` job older than the overall run window is stale (the
      // server restarted or the resolver hung) and would block retries forever.
      if (existing.status === 'downloading' && existing.startedAt) {
        const staleSince = Date.now() - existing.startedAt.getTime();
        if (staleSince > DOWNLOAD_MAX_MS) {
          await prisma.downloadJob.update({
            where: { id: existing.id },
            data: { status: 'failed', errorMessage: 'Source resolution timed out' },
          });
          return this.createAndRun(userId, track, directUrl);
        }
      }
      if (existing.status === 'completed') {
        // Legacy job from before ID3 stamping existed: tag it on demand.
        void this.ensureTagged(existing.id, existing.localPath, {
          title: track.title,
          artist: track.artists[0]?.name ?? existing.trackArtist,
          album: track.album?.title,
          artworkUrl: track.artworkUrl ?? existing.trackArtwork,
        });
      }
      return toDto(existing);
    }

    return this.createAndRun(userId, track, directUrl);
  }

  private async createAndRun(
    userId: string,
    track: CanonicalTrack,
    directUrl?: string
  ): Promise<DownloadJobDto> {
    const job = await prisma.downloadJob.create({
      data: {
        userId,
        trackId: track.id,
        trackTitle: track.title,
        trackArtist: track.artists[0]?.name ?? 'Unknown Artist',
        trackArtwork: track.artworkUrl ?? null,
        quality: 'high',
        status: 'downloading',
        progress: 0,
        startedAt: new Date(),
      },
    });

    void this.run(job.id, track, resolvedUrl(directUrl, track));
    return toDto(job);
  }

  private async run(jobId: string, track: CanonicalTrack, directUrl?: string): Promise<void> {
    try {
      const signal = AbortSignal.timeout(DOWNLOAD_MAX_MS);
      const result = await this.resolver.download(
        track,
        directUrl,
        async (percent) => {
          await prisma.downloadJob
            .update({ where: { id: jobId }, data: { progress: percent } })
            .catch(() => undefined);
        },
        signal
      );
      // Stamp ID3 metadata + cover art so the file is complete when it lands
      // in the device's Music folder. Best-effort: tagging failure never
      // fails the download.
      await tagMp3(result.filePath, {
        title: track.title,
        artist: track.artists[0]?.name,
        album: track.album?.title,
        albumArtist: track.album?.artist?.name ?? track.artists[0]?.name,
        artworkUrl: track.artworkUrl,
      }).catch(() => false);
      const bytes = await fs
        .stat(result.filePath)
        .then((s) => s.size)
        .catch(() => 0);
      await prisma.downloadJob.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          progress: 100,
          bytesDownloaded: bytes,
          provider: result.provider,
          sourceUrl: result.sourceUrl,
          localPath: result.filePath,
          completedAt: new Date(),
        },
      });
      if (this.lyrics) void this.lyrics.warmTrack(track);
    } catch (err) {
      await prisma.downloadJob
        .update({
          where: { id: jobId },
          data: {
            status: 'failed',
            errorCode: 'DOWNLOAD_FAILED',
            errorMessage: err instanceof Error ? err.message.slice(0, 500) : 'Download failed',
          },
        })
        .catch(() => undefined);
    }
  }

  async listByUser(userId: string, opts?: { take?: number }): Promise<DownloadJobDto[]> {
    const rows = await prisma.downloadJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      // Bounded so a huge history can't produce an unbounded payload.
      take: Math.min(Math.max(opts?.take ?? 200, 1), 200),
    });
    return rows.map(toDto);
  }

  async getForUser(jobId: string, userId: string): Promise<DownloadJobDto | null> {
    const row = await prisma.downloadJob.findFirst({ where: { id: jobId, userId } });
    return row ? toDto(row) : null;
  }

  async remove(jobId: string, userId: string): Promise<void> {
    const row = await prisma.downloadJob.findFirst({ where: { id: jobId, userId } });
    if (!row) throw new NotFoundError('Download not found');
    if (row.localPath)
      await fs.rm(path.resolve(row.localPath), { force: true }).catch(() => undefined);
    await prisma.downloadJob.delete({ where: { id: jobId } });
  }

  async filePath(jobId: string, userId: string): Promise<string | null> {
    const row = await prisma.downloadJob.findFirst({
      where: { id: jobId, userId, status: 'completed' },
    });
    return row?.localPath ?? null;
  }
}
