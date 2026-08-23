/**
 * Downloads store. Two-phase flow:
 *   1. "source" — the server resolves the best source through its chain
 *      (SoundCloud -> YouTube -> Jamendo -> Internet Archive -> FMA) and
 *      downloads the file server-side. We poll the job until it completes.
 *   2. "transfer" — the app pulls the finished file down to the device via the
 *      native downloader, so it is playable offline.
 *
 * Every phase is persisted, so a killed app never loses a record and in-flight
 * downloads are resumed on the next launch. Native progress events are
 * throttled to keep the JS thread responsive during large transfers.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CanonicalTrack } from '@sinc/shared';
import { apiClient } from '../../api/client';
import { musicApi } from '../../api/music';
import type { DownloadJob } from '../../api/music';
import { nativeBridge } from '../native';
import { useLyricsStore } from '../lyrics/lyricsStore';
import { track as trackAnalytics } from '../analytics/analytics';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { useDownloadProgressStore } from './downloadProgressStore';

export type DownloadPhase = 'source' | 'transfer' | 'completed' | 'failed';

export interface DownloadRecord {
  jobId: string;
  track: CanonicalTrack;
  localUri?: string;
  sizeBytes?: number;
  provider?: string | null;
  phase: DownloadPhase;
  progress: number;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

interface DownloadsState {
  downloads: DownloadRecord[];
  downloadedIds: ReadonlySet<string>;
  isDownloaded: (trackId: string) => boolean;
  getDownload: (trackId: string) => DownloadRecord | undefined;
  downloadTrack: (track: CanonicalTrack) => Promise<void>;
  removeDownload: (jobId: string) => Promise<void>;
  resumeInFlight: () => Promise<void>;
}

const POLL_INTERVAL_MS = 1500;
const MAX_SOURCE_WAIT_MS = 10 * 60_000;
const MAX_TRANSFER_WAIT_MS = 15 * 60_000;
const PROGRESS_THROTTLE_MS = 250;

function shortHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).padStart(6, '0').slice(-6);
}

function mimeForLocalUri(uri: string): string {
  return uri.toLowerCase().endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function safeFileName(track: CanonicalTrack): string {
  const raw = `${track.artists[0]?.name ?? 'unknown'}-${track.title}`
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${raw || 'track'}-${shortHash(track.id)}.mp3`;
}

/** Display name for the published copy in Music/Sinc: just the song title. */
export function publicFileName(track: CanonicalTrack): string {
  const raw = track.title
    .replace(/[/\\:*?"<>|]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
  return `${raw || 'song'}.mp3`;
}

function idsOf(items: Array<{ id?: string; track?: { id: string } }>): Set<string> {
  return new Set(items.map((i) => i.track?.id ?? i.id).filter((id): id is string => Boolean(id)));
}

function deriveDownloadedIds(downloads: DownloadRecord[]): Set<string> {
  return idsOf(downloads.filter((d) => d.phase === 'completed'));
}

export const useDownloadsStore = create<DownloadsState>()(
  persist(
    (set, get) => {
      const upsert = (jobId: string, patch: Partial<DownloadRecord>) => {
        const downloads = get().downloads.map((d) => (d.jobId === jobId ? { ...d, ...patch } : d));
        set({ downloads, downloadedIds: deriveDownloadedIds(downloads) });
      };

      let lastProgressSet = 0;
      if (nativeBridge.downloader.available()) {
        nativeBridge.downloader.addProgressListener((e) => {
          const now = Date.now();
          if (now - lastProgressSet < PROGRESS_THROTTLE_MS) return;
          lastProgressSet = now;
          const record = get().downloads.find((d) => d.jobId === e.jobId);
          if (record && record.phase === 'transfer') {
            const total = e.bytesTotal > 0 ? e.bytesTotal : 1;
            useDownloadProgressStore
              .getState()
              .setProgress(e.jobId, Math.min(99, Math.round((e.bytesDownloaded / total) * 100)));
          }
        });
      }

      const pollSource = async (
        job: DownloadJob,
        track: CanonicalTrack
      ): Promise<DownloadJob | null> => {
        let current = job;
        const deadline = Date.now() + MAX_SOURCE_WAIT_MS;
        while (Date.now() < deadline) {
          try {
            current = await musicApi.getDownload(job.id);
          } catch {
            // Keep polling; the server may be briefly unreachable.
          }
          const record = get().getDownload(track.id);
          if (!record || record.phase === 'failed' || record.phase === 'completed') return null;
          if (current.status === 'completed') return current;
          if (current.status === 'failed') {
            upsert(job.id, {
              phase: 'failed',
              error: current.errorMessage ?? 'Source could not be found',
            });
            return null;
          }
          useDownloadProgressStore.getState().setProgress(job.id, current.progress);
          await wait(POLL_INTERVAL_MS);
        }
        upsert(job.id, { phase: 'failed', error: 'Source resolution timed out' });
        return null;
      };

      const transfer = async (
        jobId: string,
        track: CanonicalTrack,
        provider?: string | null
      ): Promise<void> => {
        upsert(jobId, { phase: 'transfer', progress: 0 });
        const token = apiClient.getAccessToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
        try {
          const result = await Promise.race([
            nativeBridge.downloader.download(
              jobId,
              musicApi.downloadFileUrl(jobId),
              headers,
              safeFileName(track),
              {
                title: track.title,
                artist: track.artists[0]?.name ?? 'Unknown Artist',
                album: track.album?.title,
                publicFileName: publicFileName(track),
              }
            ),
            wait(MAX_TRANSFER_WAIT_MS).then(() => {
              throw new Error('Transfer timed out');
            }),
          ]);
          upsert(jobId, {
            phase: 'completed',
            progress: 100,
            localUri: result.localUri,
            sizeBytes: result.sizeBytes,
            provider,
            completedAt: Date.now(),
          });
          trackAnalytics('download:complete', track.id, { provider: provider ?? 'unknown' });
          useLyricsStore.getState().loadLyrics(track);
        } catch (err) {
          upsert(jobId, {
            phase: 'failed',
            error: err instanceof Error ? err.message : 'Transfer failed',
          });
        }
      };

      return {
        downloads: [],
        downloadedIds: new Set<string>(),

        isDownloaded: (trackId) => get().downloadedIds.has(trackId),

        getDownload: (trackId) => get().downloads.find((d) => d.track.id === trackId),

        downloadTrack: async (track) => {
          const existing = get().getDownload(track.id);
          if (existing && existing.phase !== 'failed') return;

          let job;
          try {
            job = await musicApi.startDownload(track.id, track);
          } catch (err) {
            const downloads: DownloadRecord[] = [
              {
                jobId: 'local-fail',
                track,
                phase: 'failed',
                progress: 0,
                error: err instanceof Error ? err.message : 'Failed to start download',
                createdAt: Date.now(),
              },
              ...get().downloads,
            ];
            set({ downloads, downloadedIds: deriveDownloadedIds(downloads) });
            return;
          }

          useDownloadProgressStore.getState().setProgress(job.id, 0);
          const downloads: DownloadRecord[] = [
            { jobId: job.id, track, phase: 'source', progress: 0, createdAt: Date.now() },
            ...get().downloads.filter((d) => d.jobId !== existing?.jobId),
          ];
          set({ downloads, downloadedIds: deriveDownloadedIds(downloads) });

          const done = await pollSource(job, track);
          if (!done) return;
          await transfer(job.id, track, done.provider);
        },

        resumeInFlight: async () => {
          const inFlight = get().downloads.filter(
            (d) => d.phase === 'source' || d.phase === 'transfer'
          );
          for (const record of inFlight) {
            let current: DownloadJob;
            try {
              current = await musicApi.getDownload(record.jobId);
            } catch {
              continue;
            }
            if (current.status === 'failed') {
              upsert(record.jobId, {
                phase: 'failed',
                error: current.errorMessage ?? 'Source could not be found',
              });
              continue;
            }
            if (current.status === 'completed') {
              await transfer(record.jobId, record.track, current.provider);
              continue;
            }
            const done = await pollSource({ ...current, id: record.jobId }, record.track);
            if (!done) continue;
            await transfer(record.jobId, record.track, done.provider);
          }
        },

        removeDownload: async (jobId) => {
          const record = get().downloads.find((d) => d.jobId === jobId);
          if (record?.localUri) {
            const fileName = record.localUri.split('/').pop();
            try {
              await nativeBridge.downloader.remove(jobId, fileName);
            } catch {
              // Local cleanup is best-effort.
            }
          }
          try {
            await musicApi.deleteDownload(jobId);
          } catch {
            // Server-side cleanup is best-effort.
          }
          const downloads = get().downloads.filter((d) => d.jobId !== jobId);
          set({ downloads, downloadedIds: deriveDownloadedIds(downloads) });
          useDownloadProgressStore.getState().clearProgress(jobId);
        },
      };
    },
    {
      name: STORAGE_KEYS.DOWNLOADS,
      storage: createJSONStorage(() => ({
        getItem: (key) => storage.getString(key),
        setItem: (key, value) => storage.setString(key, value),
        removeItem: (key) => storage.remove(key),
      })),
      version: 1,
      partialize: (state) => ({ downloads: state.downloads }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.downloadedIds = deriveDownloadedIds(state.downloads);
          void state.resumeInFlight();
        }
      },
    }
  )
);

export { mimeForLocalUri };
