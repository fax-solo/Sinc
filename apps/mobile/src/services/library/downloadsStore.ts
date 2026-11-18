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
import type { NativeDownloadStage } from '../native/types';
import { useLyricsStore } from '../lyrics/lyricsStore';
import { track as trackAnalytics } from '../analytics/analytics';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { useDownloadProgressStore } from './downloadProgressStore';
import {
  findArchiveSource,
  extensionForDownloadSource,
  findFmaSource,
  findJamendoSource,
  searchTitle,
  type LocalDownloadSource,
} from '../providers/download-source';
import { resolvePreviewUrl } from '../providers/preview';

export type DownloadPhase =
  | 'queued'
  | 'source'
  | 'transfer'
  | 'processing'
  | 'tagging'
  | 'validating'
  | 'completed'
  | 'failed';

/** User taps jump bulk imports; restart resumes queue behind both. */
export type DownloadPriority = 'user' | 'resume' | 'bulk';

/** True while a record still owns a queue slot or a native transfer. */
export function isDownloadInProgress(phase: DownloadPhase): boolean {
  return (
    phase === 'queued' ||
    phase === 'source' ||
    phase === 'transfer' ||
    phase === 'processing' ||
    phase === 'tagging' ||
    phase === 'validating'
  );
}

/** Monotonic native stages: late/duplicate events must not move backwards. */
const DOWNLOAD_STAGE_RANK: Record<NativeDownloadStage, number> = {
  processing: 2,
  tagging: 3,
  validating: 4,
};

const IN_PROGRESS_RANK: Partial<Record<DownloadPhase, number>> = {
  transfer: 1,
  processing: 2,
  tagging: 3,
  validating: 4,
};

function isNativeDownloadStage(value: unknown): value is NativeDownloadStage {
  return value === 'processing' || value === 'tagging' || value === 'validating';
}

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
  /** Consecutive automatic transfer attempts, persisted across restarts. */
  attempts?: number;
  /** Epoch ms before which an automatic retry must not start. */
  retryAt?: number;
  /** Whether this task may fall back to the on-device yt-dlp engine. */
  allowEngine?: boolean;
  /** Actual Music/Sinc display name; may differ from publicFileName (m4a/webm). */
  publishedName?: string;
}

interface DownloadsState {
  downloads: DownloadRecord[];
  downloadedIds: ReadonlySet<string>;
  pausedIds: ReadonlySet<string>;
  isDownloaded: (trackId: string) => boolean;
  getDownload: (trackId: string) => DownloadRecord | undefined;
  downloadTrack: (
    track: CanonicalTrack,
    opts?: { resumePart?: boolean; priority?: DownloadPriority; allowEngine?: boolean }
  ) => Promise<void>;
  pauseDownload: (jobId: string) => Promise<void>;
  resumeDownload: (jobId: string) => Promise<void>;
  cancelDownload: (jobId: string) => Promise<void>;
  /** Re-runs a failed job (transient failures already auto-retry). */
  retryDownload: (jobId: string, opts?: { allowEngine?: boolean }) => Promise<void>;
  setPhaseTransfer: (jobId: string) => void;
  removeDownload: (jobId: string) => Promise<void>;
  resumeInFlight: () => Promise<void>;
  /** Re-runs jobs parked by connection loss; called on reconnect. */
  resumeWaiting: () => Promise<void>;
}

const PROGRESS_THROTTLE_MS = 250;

/** Automatic transfer retries: two waits before the job is marked failed. */
const RETRY_DELAYS_MS = [5_000, 15_000] as const;

/**
 * Two transfers at a time matches the native yt-dlp pool. More than that
 * saturates phone I/O and made every job slower; fewer leaves the engine idle.
 */
export const MAX_CONCURRENT_DOWNLOADS = 2;

const PRIORITY_RANK: Record<DownloadPriority, number> = {
  user: 0,
  resume: 1,
  bulk: 2,
};

interface QueuedDownload {
  jobId: string;
  priority: DownloadPriority;
  order: number;
  run: () => Promise<void>;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  cancelled: boolean;
}

const downloadQueue: QueuedDownload[] = [];
const queuedDownloads = new Map<string, QueuedDownload>();
const runningDownloads = new Map<string, Promise<void>>();
let runningDownloadCount = 0;
let queueOrder = 0;

function hasScheduledDownload(jobId: string): boolean {
  return queuedDownloads.has(jobId) || runningDownloads.has(jobId);
}

function hasRunningDownload(jobId: string): boolean {
  return runningDownloads.has(jobId);
}

function pumpDownloadQueue(): void {
  while (runningDownloadCount < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length > 0) {
    const entry = downloadQueue.shift();
    if (!entry) return;
    queuedDownloads.delete(entry.jobId);
    if (entry.cancelled) {
      entry.resolve();
      continue;
    }
    runningDownloadCount += 1;
    const running = (async () => {
      try {
        await entry.run();
        entry.resolve();
      } catch (error) {
        entry.reject(error);
      } finally {
        runningDownloadCount = Math.max(0, runningDownloadCount - 1);
        runningDownloads.delete(entry.jobId);
        pumpDownloadQueue();
      }
    })();
    runningDownloads.set(entry.jobId, running);
  }
}

/**
 * Enqueues one job and resolves only when its run settles. A duplicate call
 * returns the existing queued/running promise instead of starting a second
 * native transfer or resetting the row.
 */
function scheduleDownload(
  jobId: string,
  priority: DownloadPriority,
  run: () => Promise<void>
): Promise<void> {
  const queued = queuedDownloads.get(jobId);
  if (queued) return queued.promise;
  const running = runningDownloads.get(jobId);
  if (running) return running;

  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const entry: QueuedDownload = {
    jobId,
    priority,
    order: queueOrder,
    run,
    promise,
    resolve,
    reject,
    cancelled: false,
  };
  queueOrder += 1;
  queuedDownloads.set(jobId, entry);
  downloadQueue.push(entry);
  // Stable priority order: a later user tap starts before an earlier bulk item.
  downloadQueue.sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.order - b.order
  );
  pumpDownloadQueue();
  return promise;
}

/** Drops a not-yet-started job; active jobs are stopped through the native bridge. */
function cancelQueuedDownload(jobId: string): boolean {
  const entry = queuedDownloads.get(jobId);
  if (!entry) return false;
  entry.cancelled = true;
  queuedDownloads.delete(jobId);
  entry.resolve();
  pumpDownloadQueue();
  return true;
}

/** Session tokens so a killed run's rejection can't clobber a newer launch. */
const launchToken = new Map<string, number>();

/** Test isolation: callers must have settled real runs before resetting. */
export function resetDownloadQueueForTests(): void {
  for (const entry of [...queuedDownloads.values()]) {
    entry.cancelled = true;
    entry.resolve();
  }
  downloadQueue.length = 0;
  queuedDownloads.clear();
  runningDownloads.clear();
  runningDownloadCount = 0;
  launchToken.clear();
  for (const timer of retryTimers.values()) clearTimeout(timer);
  retryTimers.clear();
  pendingCleanup.clear();
}

/** Finds the persisted record for a native event by jobId, if any. */
function recordByJobId(jobId: string): DownloadRecord | undefined {
  return useDownloadsStore.getState().downloads.find((d) => d.jobId === jobId);
}

/** Timers for persisted backoff windows; re-armable after a process restart. */
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearRetryTimer(jobId: string): void {
  const timer = retryTimers.get(jobId);
  if (!timer) return;
  clearTimeout(timer);
  retryTimers.delete(jobId);
}

/**
 * Waits out a persisted retry window. A restart before `retryAt` re-arms the
 * same wait instead of hammering the host or skipping the backoff.
 */
function scheduleRetryResume(record: DownloadRecord): void {
  const delayMs = Math.max(0, (record.retryAt ?? 0) - Date.now());
  clearRetryTimer(record.jobId);
  const timer = setTimeout(() => {
    retryTimers.delete(record.jobId);
    const current = recordByJobId(record.jobId);
    if (!current || !isDownloadInProgress(current.phase)) return;
    if (useDownloadsStore.getState().pausedIds.has(record.jobId)) return;
    // A new process cannot prove which source produced the old partial.
    void useDownloadsStore.getState().downloadTrack(current.track, {
      resumePart: false,
      priority: 'resume',
      allowEngine: current.allowEngine ?? false,
    });
  }, delayMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  retryTimers.set(record.jobId, timer);
}

/**
 * Removes a job's private artifacts even when the transfer never completed and
 * therefore has no `localUri`. Cancelling only the native process left `.part`
 * files (and, for the engine, eventually a tagged file) on disk forever.
 */
async function removeNativeArtifacts(record: DownloadRecord): Promise<void> {
  const fileName = record.localUri?.split('/').pop() ?? safeFileName(record.track);
  const published = record.publishedName ?? publicFileName(record.track);
  const engineSource =
    record.localUri?.includes('/sinc_yt/') ||
    record.provider === 'youtube' ||
    record.provider === 'soundcloud';
  try {
    if (engineSource) {
      await nativeBridge.yt.remove?.(fileName, published);
    } else if (record.localUri) {
      await nativeBridge.downloader.remove(record.jobId, fileName, published);
    } else {
      // The job was cancelled before it recorded a provider. Try both
      // module-owned directories; each cleanup is confined to its own dir.
      await nativeBridge.yt.remove?.(fileName, published);
      await nativeBridge.downloader.remove(record.jobId, fileName, published);
    }
  } catch {
    // Local cleanup is best-effort; the store record is what matters.
  }
}

/**
 * Native cleanup is keyed by the track-derived job id. If the user cancels
 * and immediately re-downloads, the old cleanup must finish before the new
 * transfer starts — otherwise it can discard the new job's partial/output.
 */
const pendingCleanup = new Map<string, Promise<void>>();

function queueCleanupTask(jobId: string, task: () => Promise<void>): Promise<void> {
  const previous = pendingCleanup.get(jobId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(task)
    .catch(() => undefined);
  pendingCleanup.set(jobId, current);
  void current.finally(() => {
    if (pendingCleanup.get(jobId) === current) pendingCleanup.delete(jobId);
  });
  return current;
}

function queueNativeCleanup(record: DownloadRecord): Promise<void> {
  return queueCleanupTask(record.jobId, () => removeNativeArtifacts(record));
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

export function safeFileName(track: CanonicalTrack, extension = 'mp3'): string {
  const raw = `${track.artists[0]?.name ?? 'unknown'}-${track.title}`
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const ext = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp3';
  return `${raw || 'track'}-${shortHash(track.id)}.${ext}`;
}

/** Display name for the published copy in Music/Sinc: just the song title. */
export function publicFileName(track: CanonicalTrack, extension = 'mp3'): string {
  const raw = track.title
    .replace(/[/\\:*?"<>|]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
  const ext = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp3';
  return `${raw || 'song'}.${ext}`;
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

/**
 * jobId → the direct source chosen for the current attempt. A paused/retried
 * direct transfer must resume the SAME URL: re-running the provider search can
 * return a different file, and appending its bytes to the old `.part` would
 * produce a corrupt/mixed song. In-memory only: after an app restart the part
 * is discarded and the source is re-selected.
 */
const directJobSources = new Map<string, LocalDownloadSource>();

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

/** Clears the direct-tier caches (test isolation; module state by design). */
export function resetDirectSourceMissCache(): void {
  directMissAt.clear();
  directJobSources.clear();
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
export const MIN_FULL_TRACK_MS = 45_000;
export const MAX_UNKNOWN_TRACK_MS = 20 * 60 * 1000;
export const MIN_DURATION_TOLERANCE_MS = 8_000;
export const MAX_DURATION_TOLERANCE_MS = 15_000;
export const DURATION_TOLERANCE_RATIO = 0.04;
export const TRUNCATED_DURATION_RATIO = 0.50;

export interface ValidationDiagnostic {
  status: 'validation_passed' | 'validation_failed';
  reason?:
    | 'duration_mismatch'
    | 'truncated_file'
    | 'incorrect_version'
    | 'invalid_audio'
    | 'missing_metadata'
    | 'ffprobe_failure'
    | 'post_processing_failure';
  sourceDuration?: number;
  downloadedDuration?: number;
  difference?: number;
  differencePercentage?: number;
  validationPolicy: string;
  fileReadable: boolean;
  hasAudioStream?: boolean;
  message?: string;
}

export function durationToleranceMs(expectedMs: number): number {
  const calculated = Math.round(expectedMs * DURATION_TOLERANCE_RATIO);
  return Math.min(MAX_DURATION_TOLERANCE_MS, Math.max(MIN_DURATION_TOLERANCE_MS, calculated));
}

/**
 * Validates a downloaded file's duration against the source/catalog metadata.
 * Produces structured diagnostic information to distinguish between acceptable
 * intro/outro discrepancies, truncated downloads, incorrect versions, unreadable
 * audio, or missing metadata.
 */
export function validateDownloadDuration(
  durationMs: number,
  expectedDurationMs: number | null | undefined,
  opts?: { fileReadable?: boolean; hasAudioStream?: boolean }
): ValidationDiagnostic {
  const fileReadable = opts?.fileReadable ?? true;
  const hasAudioStream = opts?.hasAudioStream ?? true;
  const actualSec = durationMs > 0 ? Math.round((durationMs / 1000) * 100) / 100 : 0;
  const expectedSec =
    expectedDurationMs && expectedDurationMs > 0
      ? Math.round((expectedDurationMs / 1000) * 100) / 100
      : undefined;

  if (!fileReadable) {
    return {
      status: 'validation_failed',
      reason: 'invalid_audio',
      sourceDuration: expectedSec,
      downloadedDuration: actualSec || undefined,
      validationPolicy: 'duration_tolerance_v2',
      fileReadable: false,
      hasAudioStream: false,
      message: 'Downloaded file is not readable audio',
    };
  }

  if (!hasAudioStream) {
    return {
      status: 'validation_failed',
      reason: 'invalid_audio',
      sourceDuration: expectedSec,
      downloadedDuration: actualSec,
      validationPolicy: 'duration_tolerance_v2',
      fileReadable: true,
      hasAudioStream: false,
      message: 'Downloaded file contains no audio stream',
    };
  }

  if (!durationMs || durationMs <= 0) {
    if (expectedDurationMs && expectedDurationMs > 0) {
      return {
        status: 'validation_failed',
        reason: 'ffprobe_failure',
        sourceDuration: expectedSec,
        downloadedDuration: 0,
        difference: expectedSec,
        differencePercentage: 100,
        validationPolicy: 'duration_tolerance_v2',
        fileReadable: true,
        hasAudioStream: true,
        message: 'Could not determine audio duration from probe',
      };
    }
    return {
      status: 'validation_failed',
      reason: 'missing_metadata',
      downloadedDuration: 0,
      validationPolicy: 'duration_tolerance_v2',
      fileReadable: true,
      hasAudioStream: true,
      message: 'Duration unknown and no catalog reference available',
    };
  }

  if (
    durationMs < MIN_FULL_TRACK_MS &&
    (!expectedDurationMs || expectedDurationMs >= MIN_FULL_TRACK_MS)
  ) {
    const diff = expectedSec != null ? Math.max(0, expectedSec - actualSec) : undefined;
    const diffPct =
      expectedSec != null ? Math.max(0, ((expectedSec - actualSec) / expectedSec) * 100) : undefined;
    return {
      status: 'validation_failed',
      reason: 'truncated_file',
      sourceDuration: expectedSec,
      downloadedDuration: actualSec,
      difference: diff != null ? Math.round(diff * 100) / 100 : undefined,
      differencePercentage: diffPct != null ? Math.round(diffPct * 100) / 100 : undefined,
      validationPolicy: 'duration_tolerance_v2',
      fileReadable: true,
      hasAudioStream: true,
      message: `Audio file is shorter than minimum track length (${actualSec}s < 45s)`,
    };
  }

  if (!expectedDurationMs || expectedDurationMs <= 0) {
    if (durationMs > MAX_UNKNOWN_TRACK_MS) {
      return {
        status: 'validation_failed',
        reason: 'duration_mismatch',
        downloadedDuration: actualSec,
        validationPolicy: 'duration_tolerance_v2',
        fileReadable: true,
        hasAudioStream: true,
        message: `Audio exceeds maximum duration for unknown length (${actualSec}s > 1200s)`,
      };
    }
    return {
      status: 'validation_passed',
      downloadedDuration: actualSec,
      validationPolicy: 'duration_tolerance_v2',
      fileReadable: true,
      hasAudioStream: true,
    };
  }

  // Check severely truncated relative to expected (< 50%)
  if (durationMs < expectedDurationMs * TRUNCATED_DURATION_RATIO) {
    const diff = Math.abs(actualSec - expectedSec!);
    const diffPct = (diff / expectedSec!) * 100;
    return {
      status: 'validation_failed',
      reason: 'truncated_file',
      sourceDuration: expectedSec,
      downloadedDuration: actualSec,
      difference: Math.round(diff * 100) / 100,
      differencePercentage: Math.round(diffPct * 100) / 100,
      validationPolicy: 'duration_tolerance_v2',
      fileReadable: true,
      hasAudioStream: true,
      message: 'Downloaded audio is severely truncated (< 50% of expected duration)',
    };
  }

  const diffMs = Math.abs(durationMs - expectedDurationMs);
  const diffSec = Math.round((diffMs / 1000) * 100) / 100;
  const diffPct = Math.round((diffSec / expectedSec!) * 10000) / 100;
  const tolerance = durationToleranceMs(expectedDurationMs);

  if (diffMs > tolerance) {
    const reason = diffPct > 20 || diffSec > 30 ? 'incorrect_version' : 'duration_mismatch';
    return {
      status: 'validation_failed',
      reason,
      sourceDuration: expectedSec,
      downloadedDuration: actualSec,
      difference: diffSec,
      differencePercentage: diffPct,
      validationPolicy: 'duration_tolerance_v2',
      fileReadable: true,
      hasAudioStream: true,
      message: `Duration difference (${diffSec}s, ${diffPct}%) exceeds tolerance (${tolerance / 1000}s)`,
    };
  }

  return {
    status: 'validation_passed',
    sourceDuration: expectedSec,
    downloadedDuration: actualSec,
    difference: diffSec,
    differencePercentage: diffPct,
    validationPolicy: 'duration_tolerance_v2',
    fileReadable: true,
    hasAudioStream: true,
  };
}

/**
 * A finished direct-source file whose probed length is this far off the
 * expected track is a preview/compilation segment or the wrong song: reject.
 * Uses the configurable validateDownloadDuration policy.
 */
export function isBadDownloadDuration(
  durationMs: number,
  expectedDurationMs: number | null | undefined
): boolean {
  return validateDownloadDuration(durationMs, expectedDurationMs).status === 'validation_failed';
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

/**
 * Content verification failures are not network failures: the file was
 * fetched, but it was the wrong recording (or the preview reference could not
 * be fetched). Retry once with a freshly resolved source instead of parking or
 * surfacing the first candidate's mismatch.
 */
export function isFingerprintError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? '';
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /^DOWNLOAD_FINGERPRINT_/.test(code) || /DOWNLOAD_FINGERPRINT_/.test(message);
}

/** A code-only bridge rejection still needs a useful message for the user. */
function fingerprintFailureMessage(err: unknown): string {
  const message = err instanceof Error ? err.message.trim() : '';
  if (message) return message;
  const code = (err as { code?: string } | null)?.code ?? '';
  return /UNAVAILABLE/.test(code)
    ? 'Could not verify the downloaded audio against the catalog preview. Please try again.'
    : 'The downloaded audio did not match the selected song. Please try again.';
}

/** A pause/cancel can beat the native action event to JS; never mark it failed. */
export function isCancelledDownloadError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? '';
  const message = err instanceof Error ? err.message : String(err ?? '');
  return code === 'DOWNLOAD_CANCELLED' || /DOWNLOAD_CANCELLED/.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wakes promptly when a pause/cancel invalidates the retry wait. */
async function sleepUnlessStopped(ms: number, stopped: () => boolean): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (stopped()) return;
    await sleep(Math.min(250, deadline - Date.now()));
  }
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
            const progressStore = useDownloadProgressStore.getState();
            if (e.bytesTotal > 0) {
              progressStore.setProgress(
                e.jobId,
                Math.min(99, Math.round((e.bytesDownloaded / e.bytesTotal) * 100))
              );
            } else {
              // Unknown length is not 99% complete. Keep the row indeterminate
              // and only show the measured transfer rate.
              progressStore.setIndeterminate(e.jobId, true);
            }
            progressStore.setSpeed(e.jobId, formatSpeed(e.speedBytesPerSec));
          }
        });
      }

      // Native emits these only after the transfer is complete. They are
      // monotonic: a duplicate, late, or malformed event cannot move a row
      // backwards (or revive a completed/failed row).
      if (nativeBridge.downloads.available()) {
        nativeBridge.downloads.addStageListener((event) => {
          if (!event || typeof event.jobId !== 'string' || !isNativeDownloadStage(event.stage)) {
            return;
          }
          const record = recordByJobId(event.jobId);
          if (!record || !isDownloadInProgress(record.phase)) return;
          const currentRank = IN_PROGRESS_RANK[record.phase];
          const nextRank = DOWNLOAD_STAGE_RANK[event.stage];
          if (currentRank == null || nextRank <= currentRank) return;
          // Reaching the first post-transfer stage proves the transfer
          // attempt succeeded, so a later restart gets a fresh retry budget.
          const patch: Partial<DownloadRecord> = { phase: event.stage, error: undefined };
          if (event.stage === 'processing') {
            patch.attempts = 0;
            patch.retryAt = undefined;
          }
          upsert(event.jobId, patch);
          // A stale byte rate from the transfer must not sit next to
          // "Processing audio…" / "Verifying audio…".
          useDownloadProgressStore.getState().setSpeed(event.jobId, null);
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
          // An explicit tap/resume replaces the persisted backoff timer.
          clearRetryTimer(jobId);
          if (existing?.phase === 'completed') return;
          if (hasScheduledDownload(jobId)) return;
          // Retries and resumes continue from any surviving `.part` rather
          // than trashing bytes the first attempt already transferred.
          let resumeNext = Boolean(opts?.resumePart);
          // After content verification rejects the audio, do not retry the
          // same direct source on the next attempt; go straight to the engine,
          // which re-searches with a fresh candidate.
          let skipDirectAfterFingerprint = false;

          // Keep the automatic-retry budget across a pause/restart, but a
          // manual retry of a hard-failed row starts a fresh budget. A
          // process death mid-transfer must not hand the job unlimited
          // retries just because the backoff deadline was already cleared.
          const carriedAttempts =
            existing && existing.phase !== 'failed' ? (existing.attempts ?? 0) : 0;

          // Bulk imports only use licensed/direct sources. The engine fallback
          // is reserved for an explicit individual download or retry.
          const priority = opts?.priority ?? 'user';
          const allowEngine = opts?.allowEngine ?? priority !== 'bulk';

          const downloads = [
            {
              jobId,
              track,
              phase: 'queued' as DownloadPhase,
              progress: 0,
              createdAt: Date.now(),
              attempts: carriedAttempts,
              retryAt: undefined,
              allowEngine,
            },
            ...get().downloads.filter((d) => d.jobId !== jobId),
          ];
          set({ downloads, downloadedIds: deriveDownloadedIds(downloads) });
          const pausedIds = new Set(get().pausedIds);
          pausedIds.delete(jobId);
          set({ pausedIds });
          const progressStore = useDownloadProgressStore.getState();
          progressStore.setProgress(jobId, 0);
          progressStore.setIndeterminate(jobId, false);
          progressStore.setSpeed(jobId, null);
          waitingForConnection.delete(jobId);
          const token = (launchToken.get(jobId) ?? 0) + 1;
          launchToken.set(jobId, token);
          const stopped = () => launchToken.get(jobId) !== token || get().pausedIds.has(jobId);

          // Resolved below, once per job, before the first attempt. Catalogue
          // rows already carry it; legacy rows are looked up by provider id or
          // strict text search. A missing preview is not fatal here, but the
          // downloader then has no content-level reference and falls back to its
          // metadata/length gates.
          let previewUrl: string | null = null;

          /** Runs one full attempt: direct tier first, then yt-dlp. */
          const attempt = async (): Promise<void> => {
            // A pause/cancel during a slow provider search must not start a
            // fresh native transfer afterwards.
            if (stopped()) throw new Error('Download stopped');
            // Fast path: a direct, downloadable file URL. On a resume/retry,
            // reuse the exact URL that produced the surviving `.part`; only a
            // fresh attempt may run the provider search again.
            const cachedDirect = resumeNext ? directJobSources.get(jobId) : undefined;
            const direct = skipDirectAfterFingerprint
              ? null
              : (cachedDirect ?? (await findDirectSource(track)));
            if (stopped()) throw new Error('Download stopped');
            if (direct && !cachedDirect) directJobSources.set(jobId, direct);
            if (direct) {
              const resumeDirect = Boolean(cachedDirect && cachedDirect.url === direct.url);
              const extension = extensionForDownloadSource(direct);
              const privateName = safeFileName(track, extension);
              const publicName = publicFileName(track, extension);
              upsert(jobId, {
                phase: 'transfer',
                progress: 5,
                provider: direct.provider,
                error: undefined,
              });
              useDownloadProgressStore.getState().setIndeterminate(jobId, true);
              let result: Awaited<ReturnType<typeof nativeBridge.downloader.download>> | null =
                null;
              try {
                result = await nativeBridge.downloader.download(
                  jobId,
                  direct.url,
                  undefined,
                  privateName,
                  {
                    title: track.title,
                    artist: track.artists[0]?.name ?? 'Unknown Artist',
                    album: track.album?.title,
                    artworkUrl: track.artworkUrl,
                    publicFileName: publicName,
                    expectedDurationMs: direct.expectedDurationMs,
                    previewUrl: previewUrl ?? undefined,
                  },
                  resumeDirect
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
                const fingerprintRejected = isFingerprintError(directErr);
                const rejectedSource =
                  /^HTTP_/.test(code) ||
                  /^HTTP_/.test(message) ||
                  code === 'DOWNLOAD_UNVERIFIED' ||
                  /^DOWNLOAD_UNVERIFIED/.test(message) ||
                  fingerprintRejected;
                if (!rejectedSource) throw directErr; // network errors: retry/park loop keeps the resume
                // A `HTTP_<code>` means the file host rejected THIS url
                // (401/403 auth, 404 taken-down, 5xx). `DOWNLOAD_UNVERIFIED`
                // means the native layer probed the finished file and its
                // length did not match the chosen track (it deletes the file
                // before publishing). `DOWNLOAD_FINGERPRINT_*` means it fetched
                // audio but the bytes did not match the catalog preview, or the
                // preview could not be checked. In every case the track may
                // still be engine-fetchable, so degrade to the yt-dlp tier.
                if (fingerprintRejected) skipDirectAfterFingerprint = true;
                directJobSources.delete(jobId);
                console.warn('Sinc direct source rejected, falling back:', jobId, code || message);
              }
              if (result) {
                if (launchToken.get(jobId) !== token) return;
                // The direct tier cannot pre-validate what the provider serves,
                // so the probed length is the acceptance gate: a preview or
                // compilation segment must fall through to the yt-dlp path
                // instead of being saved as the song.
                const durationValidation = validateDownloadDuration(
                  result.durationMs ?? 0,
                  direct.expectedDurationMs
                );
                if (durationValidation.status === 'validation_failed') {
                  console.warn(
                    'Sinc direct source duration validation failed:',
                    jobId,
                    JSON.stringify(durationValidation)
                  );
                  await nativeBridge.downloader.remove(jobId, privateName, publicName);
                  directJobSources.delete(jobId);
                  // fall through to the yt-dlp tier below
                } else {
                  directJobSources.delete(jobId);
                  waitingForConnection.delete(jobId);
                  useDownloadProgressStore.getState().clearProgress(jobId);
                  upsert(jobId, {
                    phase: 'completed',
                    progress: 100,
                    localUri: result.localUri,
                    sizeBytes: result.sizeBytes,
                    provider: direct.provider,
                    completedAt: Date.now(),
                    attempts: 0,
                    retryAt: undefined,
                    publishedName: result.publishedName ?? publicName,
                  });
                  return;
                }
              }
            }
            // yt-dlp path: always resolve through the strict artist+title
            // search. Provider IDs are not trusted as download sources: a
            // catalog id can point at a cover, a re-upload or a stale video,
            // and the native URL path cannot compare it to the chosen track.
            // Searching lets the engine apply the title/artist/duration gates.
            if (stopped()) throw new Error('Download stopped');
            if (!allowEngine) {
              throw new Error(
                'No licensed source found. Bulk downloads do not use the on-device engine; open this song to download it individually.'
              );
            }
            if (!nativeBridge.yt.available()) {
              throw new Error('The on-device media engine is not linked (yt-dlp).');
            }
            // Explicit disclosure for the individual fallback. The row shows
            // this until the native transfer-reported stage replaces it. The
            // provider is rewritten too: any earlier direct probe failed, so
            // the completed row must not claim the audio came from that source.
            upsert(jobId, {
              phase: 'source',
              progress: 10,
              provider: 'youtube',
              error:
                'No licensed source found — using the on-device engine for this individual download…',
            });
            const query = `${track.artists[0]?.name ?? 'unknown'} - ${searchTitle(track.title)}`;
            const result = await nativeBridge.yt.download(
              jobId,
              query,
              safeFileName(track),
              track.durationMs > 0 ? track.durationMs : null,
              null,
              track.title,
              resumeNext,
              track.artists[0]?.name ?? null,
              track.album?.title ?? null,
              track.artworkUrl ?? null,
              publicFileName(track),
              previewUrl
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
              provider: recordByJobId(jobId)?.provider ?? 'youtube',
              completedAt: Date.now(),
              attempts: 0,
              retryAt: undefined,
              error: undefined,
              publishedName: result.publishedName ?? publicFileName(track),
            });
          };

          const run = async (): Promise<void> => {
            // The scheduler may start this run after other queued jobs.
            // Cancellation/pause can also win the race while it waits.
            const cleanup = pendingCleanup.get(jobId);
            if (cleanup) await cleanup;
            if (stopped()) return;
            upsert(jobId, { phase: 'source', progress: 0, error: undefined });
            previewUrl = await resolvePreviewUrl(track).catch(() => null);
            if (launchToken.get(jobId) !== token) return;
            if (get().pausedIds.has(jobId)) return;
            for (let attemptIndex = carriedAttempts; ; attemptIndex += 1) {
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
                // A native notification pause/cancel can reject before its
                // action event reaches this store. Leave the row resumable
                // instead of surfacing a user-initiated stop as a failure.
                if (isCancelledDownloadError(err)) return;
                // The source downloaded successfully but its bytes are not the
                // selected recording (or the preview reference was
                // unavailable). The direct tier already fell through to the
                // engine; give the engine one fresh candidate, skipping the
                // rejected direct source entirely.
                if (attemptIndex < 1 && isFingerprintError(err)) {
                  skipDirectAfterFingerprint = true;
                  resumeNext = false;
                  upsert(jobId, {
                    phase: 'source',
                    error: 'Trying a different source…',
                    retryAt: undefined,
                  });
                  continue;
                }
                // Connection loss or a degraded link is not a failure: park
                // the job in `source` so it never shows "failed" and
                // auto-resumes when the link is back (reconnect event, the
                // park poller, next launch via resumeInFlight).
                if (!(await isDeviceOnline()) || isUnreachableNetworkError(err)) {
                  waitingForConnection.add(jobId);
                  upsert(jobId, {
                    phase: 'source',
                    error: 'Waiting for connection…',
                    retryAt: undefined,
                  });
                  useDownloadProgressStore.getState().setSpeed(jobId, null);
                  ensureParkPoller();
                  return;
                }
                // Transient transfer errors get automatic retries with
                // backoff; each retry resumes from the surviving `.part`.
                // The attempt count and retry deadline are persisted, so a
                // process death during the wait does not reset or skip it.
                if (attemptIndex < RETRY_DELAYS_MS.length && isTransientDownloadError(err)) {
                  const delayMs = RETRY_DELAYS_MS[attemptIndex] ?? RETRY_DELAYS_MS[0];
                  const nextAttempt = attemptIndex + 1;
                  upsert(jobId, {
                    phase: 'source',
                    error: `Retrying in ${Math.round(delayMs / 1000)}s…`,
                    attempts: nextAttempt,
                    retryAt: Date.now() + delayMs,
                  });
                  await sleepUnlessStopped(delayMs, stopped);
                  if (launchToken.get(jobId) !== token) return;
                  if (get().pausedIds.has(jobId)) return;
                  upsert(jobId, { retryAt: undefined });
                  resumeNext = true;
                  continue;
                }
                waitingForConnection.delete(jobId);
                directJobSources.delete(jobId);
                useDownloadProgressStore.getState().clearProgress(jobId);
                const message = isFingerprintError(err)
                  ? fingerprintFailureMessage(err)
                  : err instanceof Error
                    ? err.message
                    : 'Download failed';
                upsert(jobId, {
                  phase: 'failed',
                  progress: 0,
                  error: message,
                  attempts: 0,
                  retryAt: undefined,
                });
                trackAnalytics('download:failed', track.id, {
                  provider: get().getDownload(track.id)?.provider ?? 'unknown',
                  error: message.slice(0, 120),
                });
                console.warn('Sinc download failed', jobId, err);
                return;
              }
            }
          };
          return scheduleDownload(jobId, opts?.priority ?? 'user', run);
        },

        pauseDownload: async (jobId) => {
          const record = recordByJobId(jobId);
          if (!record) return;
          if (record.phase === 'completed' || record.phase === 'failed') return;
          // Parked jobs ("Waiting for connection…") have NO active worker;
          // queued jobs have not started either. Both must still be pausable,
          // and the queue entry must be dropped so the scheduler cannot start
          // them behind the user's back.
          const wasPaused = get().pausedIds.has(jobId);
          const wasQueued = cancelQueuedDownload(jobId);
          clearRetryTimer(jobId);
          launchToken.set(jobId, (launchToken.get(jobId) ?? 0) + 1);
          waitingForConnection.delete(jobId);
          if (!wasPaused) {
            const pausedIds = new Set(get().pausedIds);
            pausedIds.add(jobId);
            set({ pausedIds });
          }
          if (wasQueued) return;
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
          // A native pause rejects asynchronously. Let the old run release
          // its scheduler slot before queuing the resume, otherwise the same
          // job id would be treated as a duplicate and never restart.
          const interrupted = runningDownloads.get(jobId);
          if (interrupted) await interrupted;
          if (get().pausedIds.has(jobId)) return;
          await get().downloadTrack(record.track, {
            resumePart: true,
            priority: 'resume',
            allowEngine: record.allowEngine ?? false,
          });
        },

        cancelDownload: async (jobId) => {
          const record = recordByJobId(jobId);
          const wasQueued = cancelQueuedDownload(jobId);
          const wasRunning = hasRunningDownload(jobId) || waitingForConnection.has(jobId);
          clearRetryTimer(jobId);
          directJobSources.delete(jobId);
          launchToken.set(jobId, (launchToken.get(jobId) ?? 0) + 1);
          const pausedIds = new Set(get().pausedIds);
          pausedIds.delete(jobId);
          // Cancel means gone: drop the row instead of leaving a red
          // "failed" residue for a user-initiated action.
          const downloads = get().downloads.filter((d) => d.jobId !== jobId);
          set({ downloads, downloadedIds: deriveDownloadedIds(downloads), pausedIds });
          waitingForConnection.delete(jobId);
          useDownloadProgressStore.getState().clearProgress(jobId);
          // Register the cleanup before awaiting the native cancel. A quick
          // re-download then waits for this chain instead of racing it.
          const cleanup = queueCleanupTask(jobId, async () => {
            if (!wasQueued && wasRunning) {
              try {
                await nativeBridge.downloads.cancel(jobId);
              } catch {
                // Native already gone; state is what matters here.
              }
            }
            if (record) await removeNativeArtifacts(record);
          });
          await cleanup;
        },

        retryDownload: async (jobId, opts) => {
          const record = recordByJobId(jobId);
          if (!record) return;
          if (record.phase !== 'failed') return;
          // Transient errors already auto-retry; this is the manual path for
          // definitive failures (extraction blocked, no validated source…).
          // A single-row Retry is an explicit individual action, so it may use
          // the engine fallback. Retry All passes the stored policy instead so
          // a bulk import cannot mass-trigger the engine.
          await get().downloadTrack(record.track, {
            resumePart: true,
            priority: 'user',
            allowEngine: opts?.allowEngine ?? true,
          });
        },

        setPhaseTransfer: (jobId) => {
          const record = recordByJobId(jobId);
          // The engine can re-resolve a stale stream and start a second
          // transfer for the same job after a processing/tagging/validating
          // stage. That transfer action is authoritative and must reset the
          // stages instead of leaving the row stuck on "Writing tags…".
          if (
            !record ||
            (record.phase !== 'source' &&
              record.phase !== 'processing' &&
              record.phase !== 'tagging' &&
              record.phase !== 'validating')
          ) {
            return;
          }
          upsert(jobId, {
            phase: 'transfer',
            provider: record.provider ?? 'youtube',
            error: undefined,
          });
          // No progress sample yet: show "Downloading…" rather than a stale
          // 0%/source percentage until the first measured byte arrives.
          useDownloadProgressStore.getState().setIndeterminate(jobId, true);
        },

        resumeInFlight: async () => {
          const inFlight = get()
            .downloads.filter((d) => isDownloadInProgress(d.phase))
            .sort((a, b) => b.createdAt - a.createdAt);
          // A new process has no in-memory source/target map. Appending new
          // source bytes to a partial from the previous process can silently
          // corrupt the file, so restart with a fresh transfer. Same-session
          // pause/retry still resumes the original `.part`.
          const pendingResumes: Array<Promise<void>> = [];
          for (const record of inFlight) {
            if (get().pausedIds.has(record.jobId)) continue;
            if (record.retryAt && record.retryAt > Date.now()) {
              // A restart during backoff must not skip the wait.
              scheduleRetryResume(record);
              continue;
            }
            pendingResumes.push(
              get().downloadTrack(record.track, {
                resumePart: false,
                priority: 'resume',
                allowEngine: record.allowEngine ?? false,
              })
            );
          }
          await Promise.allSettled(pendingResumes);
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
          const pendingResumes: Array<Promise<void>> = [];
          for (const record of records) {
            if (record.retryAt && record.retryAt > Date.now()) {
              scheduleRetryResume(record);
              continue;
            }
            pendingResumes.push(
              get().downloadTrack(record.track, {
                resumePart: true,
                priority: 'resume',
                allowEngine: record.allowEngine ?? false,
              })
            );
          }
          await Promise.allSettled(pendingResumes);
        },

        removeDownload: async (jobId) => {
          const record = get().downloads.find((d) => d.jobId === jobId);
          if (!record) return;
          clearRetryTimer(jobId);
          directJobSources.delete(jobId);
          // Stop any in-flight transfer or park loop FIRST. The old code only
          // cleaned up completed files — an in-flight job kept transferring,
          // and on finish published the "deleted" song into Music/Sinc. After
          // a token bump any running worker's checkpoints become stale and it
          // exits without upserting a finished record for the removed row.
          const wasQueued = cancelQueuedDownload(jobId);
          const wasInFlight =
            !wasQueued && (hasRunningDownload(jobId) || waitingForConnection.has(jobId));
          launchToken.set(jobId, (launchToken.get(jobId) ?? 0) + 1);
          waitingForConnection.delete(jobId);
          if (wasInFlight) {
            try {
              await nativeBridge.downloads.cancel(jobId);
            } catch {
              // Native job already gone; state is what matters here.
            }
          }
          // yt-dlp downloads live in the yt module's `sinc_yt` dir, which the
          // generic downloader module never touches — route cleanup to the
          // module that owns the file (feature-detected for old builds).
          await queueNativeCleanup(record);
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
      if (record && isDownloadInProgress(record.phase)) {
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
      if (
        record &&
        (record.phase === 'source' ||
          record.phase === 'processing' ||
          record.phase === 'tagging' ||
          record.phase === 'validating')
      ) {
        store.setPhaseTransfer(jobId);
      }
    }
  });

  nativeBridge.downloads.addYtProgressListener((event) => {
    const { jobId, percent, speed } = event;
    const store = useDownloadsStore.getState();
    const record = recordByJobId(jobId);
    if (!record || (record.phase !== 'source' && record.phase !== 'transfer')) return;
    const known = percent != null && Number.isFinite(percent) && !event.indeterminate;
    if (__DEV__) {
      console.log(
        `Sinc yt progress ${jobId} ${known && percent != null ? `${Math.round(percent)}%` : 'unknown'} ${speed ?? ''}`
      );
    }
    if (record.phase === 'source') store.setPhaseTransfer(jobId);
    const progressStore = useDownloadProgressStore.getState();
    if (known && percent != null) {
      progressStore.setProgress(jobId, Math.min(99, percent));
    } else {
      progressStore.setIndeterminate(jobId, true);
    }
    progressStore.setSpeed(jobId, formatYtSpeed(speed));
  });
}
