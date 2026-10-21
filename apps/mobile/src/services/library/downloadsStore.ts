/**
 * Downloads store (local build). Sources are resolved on-device, never on a
 * server:
 *   1. A direct, keyless (or config-keyed) URL is preferred: Internet Archive
 *      -> Jamendo (key) -> Free Music Archive (key). Those transfer through
 *      the native downloader and are published to the Music/Sinc MediaStore.
 *   2. Otherwise the bundled yt-dlp binary resolves + downloads the best
 *      SoundCloud/YouTube match to app storage.
 *
 * Every record is persisted, so a killed app never loses a download and
 * in-flight ones are resumed on the next launch. Native progress events are
 * throttled to keep the JS thread responsive during large transfers.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CanonicalTrack } from '@sinc/shared';
import { config } from '../../app/config';
import { nativeBridge } from '../native';
import { useLyricsStore } from '../lyrics/lyricsStore';
import { track as trackAnalytics } from '../analytics/analytics';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { useDownloadProgressStore } from './downloadProgressStore';
import {
  findArchiveSource,
  findFmaSource,
  findJamendoSource,
  searchTitle,
  type LocalDownloadSource,
} from '../providers/download-source';

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
  /** Actual Music/Sinc display name; may differ from publicFileName (m4a/webm). */
  publishedName?: string;
}

interface DownloadsState {
  downloads: DownloadRecord[];
  downloadedIds: ReadonlySet<string>;
  pausedIds: ReadonlySet<string>;
  isDownloaded: (trackId: string) => boolean;
  getDownload: (trackId: string) => DownloadRecord | undefined;
  downloadTrack: (track: CanonicalTrack, opts?: { resumePart?: boolean }) => Promise<void>;
  pauseDownload: (jobId: string) => Promise<void>;
  resumeDownload: (jobId: string) => Promise<void>;
  cancelDownload: (jobId: string) => Promise<void>;
  /** Re-runs a failed job (transient failures already auto-retry). */
  retryDownload: (jobId: string) => Promise<void>;
  setPhaseTransfer: (jobId: string) => void;
  removeDownload: (jobId: string) => Promise<void>;
  resumeInFlight: () => Promise<void>;
  /** Re-runs jobs parked by connection loss; called on reconnect. */
  resumeWaiting: () => Promise<void>;
}

const PROGRESS_THROTTLE_MS = 250;

/** Job ids currently being transferred this session (blocks duplicate taps). */
const activeJobs = new Set<string>();
/** Parallel resume lane count: resumes overlap instead of summing minutes. */
const RESUME_CONCURRENCY = 2;

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        try {
          await task(items[index], index);
        } catch {
          // Individual failures must not abort the batch.
        }
      }
    })
  );
}
/** Session tokens so a killed run's rejection can't clobber a newer launch. */
const launchToken = new Map<string, number>();

/** Finds the persisted record for a native event by jobId, if any. */
function recordByJobId(jobId: string): DownloadRecord | undefined {
  return useDownloadsStore.getState().downloads.find((d) => d.jobId === jobId);
}

function shortHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).padStart(6, '0').slice(-6);
}

export function mimeForLocalUri(uri: string): string {
  const lower = uri.toLowerCase().split('?')[0];
  if (lower.endsWith('.ogg') || lower.endsWith('.oga') || lower.endsWith('.opus'))
    return 'audio/ogg';
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4') || lower.endsWith('.m4b'))
    return 'audio/mp4';
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.flac')) return 'audio/flac';
  if (lower.endsWith('.wav')) return 'audio/wav';
  return 'audio/mpeg';
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

export function jobIdForTrack(track: CanonicalTrack): string {
  return `dl-${shortHash(track.id)}-${shortHash(track.artists[0]?.name ?? '')}`;
}

/** Tries direct keyless/keyed sources in order (Archive -> Jamendo -> FMA). */
async function findDirectSourceUncached(
  track: CanonicalTrack
): Promise<LocalDownloadSource | null> {
  const archive = await findArchiveSource(track);
  if (archive) return archive;
  const jamendo = await findJamendoSource(track, config.jamendoClientId);
  if (jamendo) return jamendo;
  const fma = await findFmaSource(track, config.fmaApiKey);
  if (fma) return fma;
  return null;
}

// Misses of the direct tier are slow to discover (three provider probes with
// per-hop timeouts over a weak link) and every retry attempt would re-pay
// that latency before the engine tier even begins. Cache the verdict.
const DIRECT_MISS_TTL_MS = 20 * 60 * 1000;
/** trackId → when the direct-tier probes last came up empty. */
const directMissAt = new Map<string, number>();

/** Cache-aware miss wrapper: a track with no direct source must not re-probe
 * for 20 minutes — retries and re-taps go straight to the yt-dlp engine. */
export async function findDirectSource(track: CanonicalTrack): Promise<LocalDownloadSource | null> {
  const missAt = directMissAt.get(track.id);
  if (missAt && Date.now() - missAt < DIRECT_MISS_TTL_MS) return null;
  const source = await findDirectSourceUncached(track);
  if (source) directMissAt.delete(track.id);
  else directMissAt.set(track.id, Date.now());
  return source;
}

/** Clears the direct-tier miss cache (test isolation; module state by design). */
export function resetDirectSourceMissCache(): void {
  directMissAt.clear();
}

function providerForMediaUrl(url: string): string {
  return url.includes('soundcloud.com') ? 'soundcloud' : 'youtube';
}

/** Human-readable transfer rate: "512 B/s", "214 KiB/s", "3.2 MiB/s". */
export function formatSpeed(bytesPerSec: number | null | undefined): string | null {
  if (bytesPerSec == null || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return null;
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  const kib = bytesPerSec / 1024;
  if (kib < 1024) return `${kib >= 100 ? Math.round(kib) : kib.toFixed(1)} KiB/s`;
  const mib = kib / 1024;
  return `${mib >= 100 ? Math.round(mib) : mib.toFixed(1)} MiB/s`;
}

/** Normalizes a raw yt-dlp rate token ("214.55KiB/s") to "214.6 KiB/s" style. */
export function formatYtSpeed(token: string | null | undefined): string | null {
  if (!token) return null;
  const match = token.replace(/\s+/g, '').match(/^([0-9.]+)([KMGT]?i?B\/s)$/i);
  if (!match) return token;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return token;
  const upper = match[2].toUpperCase();
  const unit =
    upper === 'B/S'
      ? 'B/s'
      : upper === 'KIB/S' || upper === 'KB/S'
        ? 'KiB/s'
        : upper === 'MIB/S' || upper === 'MB/S'
          ? 'MiB/s'
          : upper === 'GIB/S' || upper === 'GB/S'
            ? 'GiB/s'
            : match[2];
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

// ---- connectivity-aware auto-resume --------------------------------------
// NetInfo is required lazily (same pattern as the MMKV storage fallback) so
// unit tests running in Node — where react-native can't load — treat the
// device as online instead of crashing on import.

interface NetInfoLike {
  fetch(): Promise<{ isConnected: boolean | null }>;
  addEventListener(listener: (state: { isConnected: boolean | null }) => void): () => void;
}

function loadNetInfo(): NetInfoLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-community/netinfo') as {
      default?: NetInfoLike;
    } & NetInfoLike;
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

/** Jobs parked while the connection is down; resumed automatically on reconnect. */
const waitingForConnection = new Set<string>();
let netListenerInstalled = false;
let deviceOnline = true;

function ensureNetListener(): void {
  if (netListenerInstalled) return;
  netListenerInstalled = true;
  const netInfo = loadNetInfo();
  if (!netInfo) return;
  try {
    netInfo
      .fetch()
      .then((state) => {
        deviceOnline = state.isConnected ?? true;
      })
      .catch(() => undefined);
    netInfo.addEventListener((state) => {
      const online = state.isConnected ?? true;
      const was = deviceOnline;
      deviceOnline = online;
      if (online && !was) {
        void useDownloadsStore.getState().resumeWaiting();
      }
    });
  } catch {
    // Connectivity monitoring is best-effort; downloads still work.
  }
}

async function isDeviceOnline(): Promise<boolean> {
  const netInfo = loadNetInfo();
  if (!netInfo) return deviceOnline;
  try {
    const state = await netInfo.fetch();
    deviceOnline = state.isConnected ?? true;
    return deviceOnline;
  } catch {
    return deviceOnline;
  }
}

/** Post-transfer length guards shared by both transfer paths. */
const MIN_FULL_TRACK_MS = 45_000;
const MAX_UNKNOWN_TRACK_MS = 20 * 60 * 1000;
const MIN_TRACK_RATIO = 0.8;
const MAX_TRACK_RATIO = 1.25;

/**
 * A finished direct-source file whose probed length is this far off the
 * expected track is a preview/compilation segment or the wrong song: reject
 * (0 = probe unavailable, always accepted).
 */
export function isBadDownloadDuration(
  durationMs: number,
  expectedDurationMs: number | null | undefined
): boolean {
  if (!durationMs || durationMs <= 0) return false;
  if (durationMs < MIN_FULL_TRACK_MS) return true;
  if (!expectedDurationMs || expectedDurationMs <= 0) return durationMs > MAX_UNKNOWN_TRACK_MS;
  return (
    durationMs < expectedDurationMs * MIN_TRACK_RATIO ||
    durationMs > expectedDurationMs * MAX_TRACK_RATIO
  );
}

/**
 * "Fails to download" triage: transient errors are retried automatically;
 * definitive ones (HTTP 4xx, validation failures) are surfaced immediately.
 * The native layer throws `HTTP_<code>` for bad statuses and bare
 * IOException/socket text for connection problems; the yt-dlp path throws
 * "yt-dlp timed out" or the last stderr line.
 */
export function isUnreachableNetworkError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  return /network unreachable|no address associated|name resolution|handshake operation|software caused connection abort|unreachable during the source lookup/i.test(
    raw
  );
}

export function isTransientDownloadError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const message = raw.trim();
  const httpCode = /^HTTP_(\d{3})$/i.exec(message);
  if (httpCode) return httpCode[1].startsWith('5');
  return /timed out|timeout|temporary|temporarily|network|connection|connect\b|socket|econn|eai_again|reset by peer|unexpected end|connection closed|broken pipe/i.test(
    message
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// App-foreground resume: a reconnect *event* can be missed when NetInfo was
// already offline at listener setup, so parked jobs also re-check whenever
// the app becomes active and on a slow timer while any job is parked.
// Everything here is lazily required so Node unit tests (no react-native)
// keep this module importable — same pattern as the NetInfo loader above.

let appStateInstalled = false;

interface AppStateLike {
  addEventListener(type: string, listener: (state: string) => void): { remove(): void };
}

function loadAppState(): AppStateLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native') as {
      AppState?: AppStateLike;
    };
    return mod.AppState ?? null;
  } catch {
    return null;
  }
}

function ensureAppStateResume(): void {
  if (appStateInstalled) return;
  appStateInstalled = true;
  const appState = loadAppState();
  if (!appState) return;
  try {
    appState.addEventListener('change', (state) => {
      if (state === 'active' && waitingForConnection.size > 0) {
        void useDownloadsStore.getState().resumeWaiting();
      }
    });
  } catch {
    // App-state monitoring is best-effort.
  }
}

let parkPoller: ReturnType<typeof setInterval> | null = null;

function ensureParkPoller(): void {
  if (parkPoller != null) return;
  const timer = setInterval(() => {
    // The poller outlives the parked set; disband when everything resumed.
    if (waitingForConnection.size === 0) {
      const current = parkPoller;
      parkPoller = null;
      if (current != null) clearInterval(current);
      return;
    }
    void isDeviceOnline().then((online) => {
      if (online) void useDownloadsStore.getState().resumeWaiting();
    });
  }, 60_000) as unknown as { unref?: () => void };
  // Vitest/Node timers keep the process alive; never let the poller block a test run.
  timer.unref?.();
  parkPoller = timer as unknown as ReturnType<typeof setInterval>;
}

ensureNetListener();
ensureAppStateResume();

export const useDownloadsStore = create<DownloadsState>()(
  persist(
    (set, get) => {
      const upsert = (jobId: string, patch: Partial<DownloadRecord>) => {
        const downloads = get().downloads.map((d) => (d.jobId === jobId ? { ...d, ...patch } : d));
        set({ downloads, downloadedIds: deriveDownloadedIds(downloads) });
      };

      // Per-job throttle: with 2+ concurrent transfers a single timestamp
      // made every event within 250 ms of *any other* job's update drop,
      // which looked like frozen progress bars on all but one download.
      const lastProgressAt = new Map<string, number>();
      if (nativeBridge.downloader.available()) {
        nativeBridge.downloader.addProgressListener((e) => {
          const now = Date.now();
          if (now - (lastProgressAt.get(e.jobId) ?? 0) < PROGRESS_THROTTLE_MS) return;
          lastProgressAt.set(e.jobId, now);
          const record = get().downloads.find((d) => d.jobId === e.jobId);
          if (record && record.phase === 'transfer') {
            const total = e.bytesTotal > 0 ? e.bytesTotal : 1;
            const progressStore = useDownloadProgressStore.getState();
            progressStore.setProgress(
              e.jobId,
              Math.min(99, Math.round((e.bytesDownloaded / total) * 100))
            );
            progressStore.setSpeed(e.jobId, formatSpeed(e.speedBytesPerSec));
          }
        });
      }

      return {
        downloads: [],
        downloadedIds: new Set<string>(),
        pausedIds: new Set<string>(),

        isDownloaded: (trackId) => get().downloadedIds.has(trackId),

        getDownload: (trackId) => get().downloads.find((d) => d.track.id === trackId),

        downloadTrack: async (track, opts) => {
          const jobId = jobIdForTrack(track);
          const existing = get().getDownload(track.id);
          if (existing?.phase === 'completed') return;
          if (activeJobs.has(jobId)) return;
          activeJobs.add(jobId);
          // Retries and resumes continue from any surviving `.part` rather
          // than trashing bytes the first attempt already transferred.
          let resumeNext = Boolean(opts?.resumePart);

          const downloads = [
            { jobId, track, phase: 'source' as DownloadPhase, progress: 0, createdAt: Date.now() },
            ...get().downloads.filter((d) => d.jobId !== jobId),
          ];
          set({ downloads, downloadedIds: deriveDownloadedIds(downloads) });
          const pausedIds = new Set(get().pausedIds);
          pausedIds.delete(jobId);
          set({ pausedIds });
          const progressStore = useDownloadProgressStore.getState();
          progressStore.setProgress(jobId, 0);
          progressStore.setSpeed(jobId, null);
          waitingForConnection.delete(jobId);
          const token = (launchToken.get(jobId) ?? 0) + 1;
          launchToken.set(jobId, token);

          /** Runs one full attempt: direct tier first, then yt-dlp. */
          const attempt = async (): Promise<void> => {
            // Fast path: a direct, downloadable file URL.
            const direct = await findDirectSource(track);
            if (direct) {
              upsert(jobId, { phase: 'transfer', progress: 5, provider: direct.provider });
              let result: Awaited<ReturnType<typeof nativeBridge.downloader.download>> | null =
                null;
              try {
                result = await nativeBridge.downloader.download(
                  jobId,
                  direct.url,
                  undefined,
                  safeFileName(track),
                  {
                    title: track.title,
                    artist: track.artists[0]?.name ?? 'Unknown Artist',
                    album: track.album?.title,
                    publicFileName: publicFileName(track),
                    expectedDurationMs: direct.expectedDurationMs,
                  },
                  resumeNext
                );
              } catch (directErr) {
                if (launchToken.get(jobId) !== token) return;
                if (get().pausedIds.has(jobId)) return;
                // The RN bridge rejects with the status in `code` and an EMPTY
                // message, so the message alone is not enough to classify.
                const code = (directErr as { code?: string } | null)?.code ?? '';
                const message = (
                  directErr instanceof Error ? directErr.message : String(directErr ?? '')
                ).trim();
                if (!/^HTTP_/.test(code) && !/^HTTP_/.test(message)) throw directErr; // network errors: retry/park loop keeps the resume
                // A `HTTP_<code>` means the file host rejected THIS url
                // (401/403 auth, 404 taken-down, 5xx): the track may still be
                // engine-fetchable, so degrade to the yt-dlp tier instead of
                // failing the whole job.
                console.warn('Sinc direct source rejected, falling back:', jobId, code || message);
              }
              if (result) {
                if (launchToken.get(jobId) !== token) return;
                // The direct tier cannot pre-validate what the provider serves,
                // so the probed length is the acceptance gate: a preview or
                // compilation segment must fall through to the yt-dlp path
                // instead of being saved as the song.
                if (isBadDownloadDuration(result.durationMs ?? 0, direct.expectedDurationMs)) {
                  await nativeBridge.downloader.remove(
                    jobId,
                    safeFileName(track),
                    publicFileName(track)
                  );
                  // fall through to the yt-dlp tier below
                } else {
                  waitingForConnection.delete(jobId);
                  useDownloadProgressStore.getState().clearProgress(jobId);
                  upsert(jobId, {
                    phase: 'completed',
                    progress: 100,
                    localUri: result.localUri,
                    sizeBytes: result.sizeBytes,
                    provider: direct.provider,
                    completedAt: Date.now(),
                  });
                  return;
                }
              }
            }
            // yt-dlp path: reuse a known soundcloud/youtube result, else search
            // (also the fallback when a direct source downloaded garbage).
            if (!nativeBridge.yt.available()) {
              throw new Error('The on-device media engine is not linked (yt-dlp).');
            }
            upsert(jobId, { phase: 'source', progress: 10 });
            const mediaUrl = track.providerIds.soundcloud ?? track.providerIds.youtube ?? null;
            const query = mediaUrl
              ? mediaUrl
              : `${track.artists[0]?.name ?? 'unknown'} - ${searchTitle(track.title)}`;
            const result = await nativeBridge.yt.download(
              jobId,
              mediaUrl ? '' : query,
              safeFileName(track),
              track.durationMs > 0 ? track.durationMs : null,
              mediaUrl,
              track.title,
              resumeNext,
              track.artists[0]?.name ?? null,
              track.album?.title ?? null,
              track.artworkUrl ?? null,
              publicFileName(track)
            );
            if (launchToken.get(jobId) !== token) return;
            if (!result) {
              throw new Error('No downloadable source was found for this track');
            }
            waitingForConnection.delete(jobId);
            useDownloadProgressStore.getState().clearProgress(jobId);
            upsert(jobId, {
              phase: 'completed',
              progress: 100,
              localUri: result.localUri,
              sizeBytes: 0,
              provider: mediaUrl
                ? providerForMediaUrl(mediaUrl)
                : (recordByJobId(jobId)?.provider ?? 'youtube'),
              completedAt: Date.now(),
              publishedName: result.publishedName ?? publicFileName(track),
            });
          };

          try {
            for (let attemptIndex = 0; ; attemptIndex += 1) {
              try {
                await attempt();
                trackAnalytics('download:complete', track.id, {
                  provider: get().getDownload(track.id)?.provider ?? 'unknown',
                });
                useLyricsStore.getState().loadLyrics(track);
                return;
              } catch (err) {
                // A pause/cancel kills the engine process; the newer launch
                // owns this job now, so the stale rejection must not mark it
                // failed (or burn retries on it).
                if (launchToken.get(jobId) !== token) return;
                if (get().pausedIds.has(jobId)) return;
                // Connection loss or a degraded link is not a failure: park
                // the job in `source` so it never shows "failed" and
                // auto-resumes when the link is back (reconnect event, the
                // park poller, next launch via resumeInFlight).
                if (!(await isDeviceOnline()) || isUnreachableNetworkError(err)) {
                  waitingForConnection.add(jobId);
                  upsert(jobId, {
                    phase: 'source',
                    error: 'Waiting for connection…',
                  });
                  useDownloadProgressStore.getState().setSpeed(jobId, null);
                  ensureParkPoller();
                  return;
                }
                // Transient transfer errors get automatic retries with
                // backoff; each retry resumes from the surviving `.part`.
                if (attemptIndex < 2 && isTransientDownloadError(err)) {
                  const delayMs = [5_000, 15_000][attemptIndex];
                  upsert(jobId, {
                    phase: 'source',
                    error: `Retrying in ${Math.round(delayMs / 1000)}s…`,
                  });
                  await sleep(delayMs);
                  if (launchToken.get(jobId) !== token) return;
                  if (get().pausedIds.has(jobId)) return;
                  resumeNext = true;
                  continue;
                }
                waitingForConnection.delete(jobId);
                useDownloadProgressStore.getState().clearProgress(jobId);
                const message = err instanceof Error ? err.message : 'Download failed';
                upsert(jobId, {
                  phase: 'failed',
                  progress: 0,
                  error: message,
                });
                trackAnalytics('download:failed', track.id, {
                  provider: get().getDownload(track.id)?.provider ?? 'unknown',
                  error: message.slice(0, 120),
                });
                console.warn('Sinc download failed', jobId, err);
                return;
              }
            }
          } finally {
            activeJobs.delete(jobId);
          }
        },

        pauseDownload: async (jobId) => {
          const record = recordByJobId(jobId);
          if (!record) return;
          if (record.phase === 'completed' || record.phase === 'failed') return;
          // Parked jobs ("Waiting for connection…") have NO active worker —
          // the old activeJobs guard made Pause a dead button on those rows
          // while the park poller kept auto-reviving them against the user's
          // wishes. Paused ids are honored by every resume path.
          const wasPaused = get().pausedIds.has(jobId);
          activeJobs.delete(jobId);
          launchToken.set(jobId, (launchToken.get(jobId) ?? 0) + 1);
          waitingForConnection.delete(jobId);
          if (!wasPaused) {
            const pausedIds = new Set(get().pausedIds);
            pausedIds.add(jobId);
            set({ pausedIds });
          }
          try {
            await nativeBridge.downloads.pause(jobId);
          } catch {
            // Native job already gone; the paused record is what matters.
          }
        },

        resumeDownload: async (jobId) => {
          const record = recordByJobId(jobId);
          if (!record) return;
          if (!get().pausedIds.has(jobId)) return;
          if (record.phase === 'completed' || record.phase === 'failed') return;
          const pausedIds = new Set(get().pausedIds);
          pausedIds.delete(jobId);
          set({ pausedIds });
          launchToken.set(jobId, (launchToken.get(jobId) ?? 0) + 1);
          await get().downloadTrack(record.track, { resumePart: true });
        },

        cancelDownload: async (jobId) => {
          activeJobs.delete(jobId);
          launchToken.set(jobId, (launchToken.get(jobId) ?? 0) + 1);
          const pausedIds = new Set(get().pausedIds);
          pausedIds.delete(jobId);
          // Cancel means gone: drop the row instead of leaving a red
          // "failed" residue for a user-initiated action.
          const downloads = get().downloads.filter((d) => d.jobId !== jobId);
          set({ downloads, downloadedIds: deriveDownloadedIds(downloads), pausedIds });
          waitingForConnection.delete(jobId);
          useDownloadProgressStore.getState().clearProgress(jobId);
          try {
            await nativeBridge.downloads.cancel(jobId);
          } catch {
            // Native already gone; state is what matters here.
          }
        },

        retryDownload: async (jobId) => {
          const record = recordByJobId(jobId);
          if (!record) return;
          if (record.phase !== 'failed') return;
          // Transient errors already auto-retry; this is the manual path for
          // definitive failures (extraction blocked, no validated source…).
          await get().downloadTrack(record.track, { resumePart: true });
        },

        setPhaseTransfer: (jobId) => {
          const record = recordByJobId(jobId);
          if (!record || record.phase !== 'source') return;
          upsert(jobId, { phase: 'transfer', provider: record.provider ?? 'youtube' });
        },

        resumeInFlight: async () => {
          const inFlight = get()
            .downloads.filter((d) => d.phase === 'source' || d.phase === 'transfer')
            .sort((a, b) => b.createdAt - a.createdAt);
          await runWithConcurrency(inFlight, RESUME_CONCURRENCY, async (record, index) => {
            if (get().pausedIds.has(record.jobId)) return;
            // Staggered starts: the newest job — the one the user most likely
            // just tapped — hits the lookup gates NOW; older jobs enter
            // seconds apart instead of all queueing behind each other at boot
            // (that pile-up is what made every resume feel 1-3 minutes slow).
            await new Promise((r) => setTimeout(r, index * 7_000));
            await get().downloadTrack(record.track, { resumePart: true });
          });
        },

        resumeWaiting: async () => {
          if (waitingForConnection.size === 0) return;
          const ids = [...waitingForConnection];
          waitingForConnection.clear();
          const records: DownloadRecord[] = [];
          for (const jobId of ids) {
            const record = recordByJobId(jobId);
            if (!record) continue;
            if (record.phase === 'completed' || get().pausedIds.has(jobId)) continue;
            records.push(record);
          }
          records.sort((a, b) => b.createdAt - a.createdAt);
          await runWithConcurrency(records, RESUME_CONCURRENCY, async (record, index) => {
            await new Promise((r) => setTimeout(r, index * 7_000));
            await get().downloadTrack(record.track, { resumePart: true });
          });
        },

        removeDownload: async (jobId) => {
          const record = get().downloads.find((d) => d.jobId === jobId);
          if (!record) return;
          // Stop any in-flight transfer or park loop FIRST. The old code only
          // cleaned up completed files — an in-flight job kept transferring,
          // and on finish published the "deleted" song into Music/Sinc. After
          // a token bump any running worker's checkpoints become stale and it
          // exits without upserting a finished record for the removed row.
          const wasInFlight = activeJobs.has(jobId) || waitingForConnection.has(jobId);
          if (wasInFlight) {
            activeJobs.delete(jobId);
            launchToken.set(jobId, (launchToken.get(jobId) ?? 0) + 1);
            waitingForConnection.delete(jobId);
            try {
              await nativeBridge.downloads.cancel(jobId);
            } catch {
              // Native job already gone; state is what matters here.
            }
          }
          if (record.localUri) {
            const fileName = record.localUri.split('/').pop();
            try {
              // yt-dlp downloads live in the yt module's `sinc_yt` dir, which
              // the generic downloader module never touches — route cleanup to
              // the module that owns the file (feature-detected for old builds).
              if (
                fileName &&
                record.localUri.includes('/sinc_yt/') &&
                typeof nativeBridge.yt.remove === 'function'
              ) {
                await nativeBridge.yt.remove(
                  fileName,
                  record.publishedName ?? publicFileName(record.track)
                );
              } else {
                await nativeBridge.downloader.remove(jobId, fileName, publicFileName(record.track));
              }
            } catch {
              // Local cleanup is best-effort.
            }
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
      partialize: (state) => ({
        downloads: state.downloads,
        // Persisted: a manual pause must survive an app restart — otherwise
        // resumeInFlight() restarted jobs the user explicitly paused.
        pausedIds: Array.from(state.pausedIds),
      }),
      // Sets don't survive JSON persistence; rebuild from the array.
      merge: (persisted, current) => {
        const saved = persisted as Partial<{ downloads: DownloadRecord[]; pausedIds: string[] }>;
        return {
          ...current,
          ...saved,
          pausedIds: new Set(saved.pausedIds ?? []),
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.downloadedIds = deriveDownloadedIds(state.downloads);
          void state.resumeInFlight();
        }
      },
    }
  )
);

// ---- Native download event wiring -----------------------------------
// Foreground-notification buttons and yt-dlp progress lines arrive here and
// update the persisted records.
if (nativeBridge.downloads.available()) {
  nativeBridge.downloads.addActionListener(({ jobId, action }) => {
    const store = useDownloadsStore.getState();
    if (action === 'cancelled') {
      const record = recordByJobId(jobId);
      if (record && (record.phase === 'source' || record.phase === 'transfer')) {
        void store.cancelDownload(jobId);
      }
    } else if (action === 'paused') {
      void store.pauseDownload(jobId);
    } else if (action === 'resume') {
      void store.resumeDownload(jobId);
    } else if (action === 'transfer') {
      // Native just spawned the engine download: flip the row out of the
      // "resolving source" state immediately (the first % line can lag
      // behind whole seconds of buffered yt-dlp output on slow links).
      const record = recordByJobId(jobId);
      if (record && record.phase === 'source') store.setPhaseTransfer(jobId);
    }
  });

  nativeBridge.downloads.addYtProgressListener(({ jobId, percent, speed }) => {
    const store = useDownloadsStore.getState();
    const record = recordByJobId(jobId);
    if (!record || (record.phase !== 'source' && record.phase !== 'transfer')) return;
    if (__DEV__) {
      console.log(`Sinc yt progress ${jobId} ${Math.round(percent)}% ${speed ?? ''}`);
    }
    if (record.phase === 'source') store.setPhaseTransfer(jobId);
    const progressStore = useDownloadProgressStore.getState();
    progressStore.setProgress(jobId, Math.min(99, percent));
    progressStore.setSpeed(jobId, formatYtSpeed(speed));
  });
}
