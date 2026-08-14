import type { Database } from '@nozbe/watermelondb';
import { musicApi } from '../api/music';
import {
  clearCompletedDownloads,
  downloadsQuery,
  enqueueDownloadJob,
  getDownloadJob,
  patchDownloadJob,
  removeDownloadJob,
  type NewDownloadInput,
} from '../db/downloads';
import {
  downloadsNative,
  isDownloadsNativeAvailable,
  subscribeToDownloadEvents,
  type NativeDownloadStatus,
} from './native';

export const LOW_STORAGE_THRESHOLD_BYTES = 300 * 1024 * 1024;
const POLL_INTERVAL_MS = 1500;
const WRITE_THROTTLE_MS = 500;

export type DownloadEnqueueResult =
  | { ok: true }
  | { ok: false; reason: 'low-storage' | 'native-unavailable' | 'already-downloading' }
  | { ok: false; reason: 'failed'; message: string };

const pollers = new Map<string, ReturnType<typeof setInterval>>();
const lastWriteAt = new Map<string, number>();

function stopPoller(trackId: string): void {
  const poller = pollers.get(trackId);
  if (poller) {
    clearInterval(poller);
    pollers.delete(trackId);
  }
  lastWriteAt.delete(trackId);
}

function shouldWrite(trackId: string, now: number): boolean {
  const last = lastWriteAt.get(trackId) ?? 0;
  if (now - last < WRITE_THROTTLE_MS) return false;
  lastWriteAt.set(trackId, now);
  return true;
}

async function finalizeCompleted(
  db: Database,
  trackId: string,
  status: NativeDownloadStatus,
): Promise<void> {
  stopPoller(trackId);
  const localUri = status.localUri ?? (await downloadsNative.getLocalUri(trackId));
  await patchDownloadJob(db, trackId, {
    status: 'COMPLETED',
    progressPct: 100,
    bytesDownloaded: status.bytesDownloaded,
    bytesTotal: status.bytesTotal,
    localUri,
    completedAt: Date.now(),
    errorCode: null,
    errorMessage: null,
  });
  await maybeNotifyBatch(db, trackId);
}

async function finalizeFailed(
  db: Database,
  trackId: string,
  errorCode?: string | null,
): Promise<void> {
  stopPoller(trackId);
  await patchDownloadJob(db, trackId, {
    status: 'FAILED',
    errorCode: errorCode ?? null,
    errorMessage: errorCode ?? null,
  });
  await maybeNotifyBatch(db, trackId);
}

async function maybeNotifyBatch(db: Database, trackId: string): Promise<void> {
  const job = await getDownloadJob(db, trackId);
  if (!job?.batchId) return;
  const siblings = await downloadsQuery(db).fetch();
  const inBatch = siblings.filter((row) => row.batchId === job.batchId);
  if (inBatch.length < 2) return;
  const allTerminal = inBatch.every((row) =>
    ['COMPLETED', 'FAILED', 'CANCELLED'].includes(row.status),
  );
  if (!allTerminal) return;
  const completed = inBatch.filter((row) => row.status === 'COMPLETED').length;
  if (completed > 0) {
    downloadsNative.notifyBatchComplete(completed);
  }
}

function startPoller(db: Database, trackId: string): void {
  if (pollers.has(trackId)) return;
  const poller = setInterval(() => {
    void downloadsNative
      .queryProgress(trackId)
      .then((status) => handleNativeStatus(db, trackId, status))
      .catch(() => undefined);
  }, POLL_INTERVAL_MS);
  pollers.set(trackId, poller);
}

async function handleNativeStatus(
  db: Database,
  trackId: string,
  status: NativeDownloadStatus,
): Promise<void> {
  const job = await getDownloadJob(db, trackId);
  if (!job || job.status === 'COMPLETED' || job.status === 'CANCELLED') {
    stopPoller(trackId);
    return;
  }
  if (status.state === 'completed') {
    await finalizeCompleted(db, trackId, status);
    return;
  }
  if (status.state === 'failed') {
    await finalizeFailed(db, trackId, status.errorCode);
    return;
  }
  if (status.state === 'unknown') {
    return;
  }
  if (shouldWrite(trackId, Date.now())) {
    const bytesTotal = status.bytesTotal > 0 ? status.bytesTotal : null;
    const progressPct = bytesTotal
      ? Math.min(99, Math.round((status.bytesDownloaded / bytesTotal) * 100))
      : job.progressPct;
    await patchDownloadJob(db, trackId, {
      status: 'DOWNLOADING',
      bytesDownloaded: status.bytesDownloaded,
      bytesTotal,
      progressPct,
    });
  }
}

async function startDownload(db: Database, trackId: string): Promise<DownloadEnqueueResult> {
  const job = await getDownloadJob(db, trackId);
  if (!job) return { ok: false, reason: 'failed', message: 'Job not found' };
  if (['DOWNLOADING', 'RESOLVING', 'PROCESSING', 'FINALIZING'].includes(job.status)) {
    return { ok: false, reason: 'already-downloading' };
  }
  try {
    const resolved = await musicApi.resolvePlayback(trackId);
    await downloadsNative.enqueueDownload(trackId, resolved.source.uri, job.title);
    await patchDownloadJob(db, trackId, {
      status: 'DOWNLOADING',
      startedAt: Date.now(),
      errorCode: null,
      errorMessage: null,
      progressPct: 0,
      bytesDownloaded: 0,
    });
    startPoller(db, trackId);
    return { ok: true };
  } catch (error) {
    await patchDownloadJob(db, trackId, {
      status: 'FAILED',
      errorCode: 'RESOLVE_FAILED',
      errorMessage: String(error),
    });
    return { ok: false, reason: 'failed', message: String(error) };
  }
}

export interface DownloadService {
  enqueueDownload(db: Database, input: NewDownloadInput): Promise<DownloadEnqueueResult>;
  /** Enqueues a group of tracks sharing one batch id (aggregate notification). */
  enqueueBatch(db: Database, inputs: NewDownloadInput[]): Promise<DownloadEnqueueResult[]>;
  pauseDownload(db: Database, trackId: string): Promise<void>;
  resumeDownload(db: Database, trackId: string): Promise<DownloadEnqueueResult>;
  cancelDownload(db: Database, trackId: string): Promise<void>;
  retryDownload(db: Database, trackId: string): Promise<DownloadEnqueueResult>;
  deleteDownload(db: Database, trackId: string): Promise<void>;
  clearCompleted(db: Database): Promise<number>;
  reconcileDownloads(db: Database): Promise<void>;
  storageInfo(): Promise<{ freeBytes: number; low: boolean }>;
  start(db: Database): () => void;
}

/**
 * Downloads orchestration (M3.3/M4.2). Jobs persist in the local DB; the
 * system DownloadManager does the actual transfer; progress is polled and
 * throttled; completion/failure arrive via native events.
 */
export function createDownloadService(): DownloadService {
  let db: Database | null = null;
  let unsubscribed: (() => void) | null = null;

  const service: DownloadService = {
    async enqueueDownload(db, input) {
      if (!isDownloadsNativeAvailable()) {
        return { ok: false, reason: 'native-unavailable' };
      }
      const { low } = await service.storageInfo();
      if (low) return { ok: false, reason: 'low-storage' };
      const job = await enqueueDownloadJob(db, input);
      if (!job) {
        const existing = await getDownloadJob(db, input.trackId);
        return existing && ['DOWNLOADING', 'RESOLVING'].includes(existing.status)
          ? { ok: false, reason: 'already-downloading' }
          : { ok: true };
      }
      return startDownload(db, input.trackId);
    },

    async enqueueBatch(db, inputs) {
      if (inputs.length === 0) return [];
      const batchId = Date.now().toString();
      const results: DownloadEnqueueResult[] = [];
      for (const input of inputs) {
        results.push(await service.enqueueDownload(db, { ...input, batchId }));
      }
      return results;
    },

    async pauseDownload(db, trackId) {
      stopPoller(trackId);
      await downloadsNative.cancelDownload(trackId);
      await patchDownloadJob(db, trackId, { status: 'PAUSED' });
    },

    async resumeDownload(db, trackId) {
      return startDownload(db, trackId);
    },

    async cancelDownload(db, trackId) {
      stopPoller(trackId);
      await downloadsNative.cancelDownload(trackId);
      await removeDownloadJob(db, trackId);
    },

    async retryDownload(db, trackId) {
      return startDownload(db, trackId);
    },

    async deleteDownload(db, trackId) {
      stopPoller(trackId);
      await downloadsNative.deleteFile(trackId);
      await removeDownloadJob(db, trackId);
    },

    async clearCompleted(db) {
      const jobs = await downloadsQuery(db, ['COMPLETED', 'FAILED', 'CANCELLED']).fetch();
      for (const job of jobs) {
        await downloadsNative.deleteFile(job.id);
      }
      return clearCompletedDownloads(db);
    },

    async reconcileDownloads(db) {
      const active = await downloadsQuery(db, [
        'QUEUED',
        'RESOLVING',
        'DOWNLOADING',
        'PAUSED',
      ]).fetch();
      for (const job of active) {
        if (job.status === 'PAUSED') continue;
        const status = await downloadsNative.queryProgress(job.id).catch(() => null);
        if (!status || status.state === 'unknown') {
          if (job.status === 'QUEUED') {
            await startDownload(db, job.id);
          } else {
            await patchDownloadJob(db, job.id, {
              status: 'FAILED',
              errorCode: 'RECONCILE_LOST',
              errorMessage: 'Download was interrupted and its system job is gone',
            });
          }
          continue;
        }
        await handleNativeStatus(db, job.id, status);
      }
    },

    async storageInfo() {
      const freeBytes = await downloadsNative.getFreeBytes();
      return { freeBytes, low: freeBytes < LOW_STORAGE_THRESHOLD_BYTES };
    },

    start(activeDb) {
      db = activeDb;
      if (unsubscribed) return unsubscribed;
      const unsubscribe = subscribeToDownloadEvents((event) => {
        if (!db) return Promise.resolve();
        return handleNativeStatus(db, event.trackId, {
          state: event.state,
          bytesDownloaded: event.bytesDownloaded,
          bytesTotal: event.bytesTotal,
          localUri: event.localUri,
          errorCode: event.errorCode,
        });
      });
      unsubscribed = unsubscribe;
      return unsubscribe;
    },
  };

  return service;
}

/** Installs the service globally and wires native events to the database. */
export function installDownloadsService(db: Database): () => void {
  return createDownloadService().start(db);
}
