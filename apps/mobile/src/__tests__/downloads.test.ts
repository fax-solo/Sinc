import { beforeEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { librarySchema } from '../db/schema';
import { createDatabase } from '../db/database';
import {
  downloadsQuery,
  enqueueDownloadJob,
  getDownloadJob,
  patchDownloadJob,
} from '../db/downloads';
import { createDownloadService } from '../downloads/service';
import { musicApi } from '../api/music';
import { downloadsNative } from '../downloads/native';

vi.mock('@nozbe/watermelondb/adapters/sqlite', () => ({ default: class SQLiteAdapterMock {} }));
vi.mock('../api/music', () => ({
  musicApi: { resolvePlayback: vi.fn() },
}));
vi.mock('../downloads/native', () => {
  const handlers: Array<
    (event: {
      trackId: string;
      state: string;
      bytesDownloaded: number;
      bytesTotal: number;
      localUri?: string | null;
      errorCode?: string | null;
    }) => void
  > = [];
  return {
    isDownloadsNativeAvailable: vi.fn(() => true),
    downloadsNative: {
      enqueueDownload: vi.fn(async () => 1),
      cancelDownload: vi.fn(async () => undefined),
      queryProgress: vi.fn(async () => ({ state: 'unknown', bytesDownloaded: 0, bytesTotal: 0 })),
      getLocalUri: vi.fn(async () => null),
      deleteFile: vi.fn(async () => true),
      getFreeBytes: vi.fn(async () => 1024 * 1024 * 1024),
      notifyBatchComplete: vi.fn(),
    },
    subscribeToDownloadEvents: vi.fn((handler) => {
      handlers.push(handler);
      return () => {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      };
    }),
    __downloadTestEmit: async (event: {
      trackId: string;
      state: string;
      bytesDownloaded: number;
      bytesTotal: number;
      localUri?: string | null;
      errorCode?: string | null;
    }) => {
      await Promise.all(handlers.map((handler) => Promise.resolve(handler(event))));
    },
  };
});

const mockResolve = vi.mocked(musicApi.resolvePlayback);
const native = vi.mocked(downloadsNative);
const mockNative = vi.mocked(native);

interface TestEvent {
  trackId: string;
  state: string;
  bytesDownloaded: number;
  bytesTotal: number;
  localUri?: string | null;
  errorCode?: string | null;
}

const emitEvent = (event: TestEvent) => emitTestEvent(event);

let emitTestEvent: (event: TestEvent) => Promise<void> = async () => undefined;

function makeDb(name: string): Database {
  return createDatabase(
    new LokiJSAdapter({
      dbName: name,
      schema: librarySchema,
      useWebWorker: false,
      useIncrementalIndexedDB: true,
    }),
  );
}

describe('downloads service', () => {
  let db: Database;
  let service: ReturnType<typeof createDownloadService>;

  beforeAll(async () => {
    const mod = (await import('../downloads/native')) as unknown as {
      __downloadTestEmit: (event: TestEvent) => Promise<void>;
    };
    emitTestEvent = mod.__downloadTestEmit;
  });

  beforeEach(() => {
    db = makeDb(`downloads-${Math.random().toString(36).slice(2)}`);
    service = createDownloadService();
    mockResolve.mockReset();
    mockResolve.mockResolvedValue({
      track: { id: 't1', title: 'Track t1' },
      source: { type: 'remote', uri: 'https://cdn.example/t1.mp3', trackId: 't1' },
      confidence: 1,
      expiresAt: Date.now() + 60_000,
    } as never);
    mockNative.enqueueDownload.mockClear();
    mockNative.cancelDownload.mockClear();
    mockNative.queryProgress.mockClear();
    mockNative.getLocalUri.mockClear();
    mockNative.deleteFile.mockClear();
    mockNative.getFreeBytes.mockClear();
    mockNative.notifyBatchComplete.mockClear();
    mockNative.getFreeBytes.mockResolvedValue(1024 * 1024 * 1024);
    mockNative.queryProgress.mockResolvedValue({
      state: 'unknown',
      bytesDownloaded: 0,
      bytesTotal: 0,
    });
  });

  it('enqueues a job, resolves a signed URL and starts downloading', async () => {
    const result = await service.enqueueDownload(db, {
      trackId: 't1',
      title: 'Track t1',
      artist: 'Artist One',
    });

    expect(result).toEqual({ ok: true });
    expect(mockResolve).toHaveBeenCalledWith('t1');
    expect(mockNative.enqueueDownload).toHaveBeenCalledWith(
      't1',
      'https://cdn.example/t1.mp3',
      'Track t1',
    );
    const job = await getDownloadJob(db, 't1');
    expect(job?.status).toBe('DOWNLOADING');
    expect(job?.startedAt).toBeTruthy();
  });

  it('does not duplicate a job that is already downloading', async () => {
    await service.enqueueDownload(db, { trackId: 't1', title: 'Track t1' });
    const result = await service.enqueueDownload(db, { trackId: 't1', title: 'Track t1' });
    expect(result).toEqual({ ok: false, reason: 'already-downloading' });
    expect(mockNative.enqueueDownload).toHaveBeenCalledTimes(1);
  });

  it('refuses to enqueue when storage is low', async () => {
    mockNative.getFreeBytes.mockResolvedValue(10 * 1024 * 1024);
    const result = await service.enqueueDownload(db, { trackId: 't1', title: 'Track t1' });
    expect(result).toEqual({ ok: false, reason: 'low-storage' });
    expect(await getDownloadJob(db, 't1')).toBeNull();
  });

  it('finalizes a completed download from a native event', async () => {
    await service.enqueueDownload(db, { trackId: 't1', title: 'Track t1' });
    mockNative.getLocalUri.mockResolvedValue('/data/sinc_t1.mp3');

    const sub = service.start(db);
    await emitEvent({
      trackId: 't1',
      state: 'completed',
      bytesDownloaded: 1024,
      bytesTotal: 1024,
      localUri: '/data/sinc_t1.mp3',
    });
    sub();

    const job = await getDownloadJob(db, 't1');
    expect(job?.status).toBe('COMPLETED');
    expect(job?.localUri).toBe('/data/sinc_t1.mp3');
    expect(job?.completedAt).toBeTruthy();
  });

  it('marks a failed download from a native event', async () => {
    await service.enqueueDownload(db, { trackId: 't1', title: 'Track t1' });
    const sub = service.start(db);
    await emitEvent({
      trackId: 't1',
      state: 'failed',
      bytesDownloaded: 0,
      bytesTotal: 0,
      errorCode: 'DM_3',
    });
    sub();

    const job = await getDownloadJob(db, 't1');
    expect(job?.status).toBe('FAILED');
    expect(job?.errorCode).toBe('DM_3');
  });

  it('throttles progress writes while polling', async () => {
    vi.useFakeTimers();
    await service.enqueueDownload(db, { trackId: 't1', title: 'Track t1' });
    mockNative.queryProgress.mockResolvedValue({
      state: 'downloading',
      bytesDownloaded: 500,
      bytesTotal: 1000,
    });

    await vi.advanceTimersByTimeAsync(1600);
    await vi.advanceTimersByTimeAsync(1600);
    await Promise.resolve();
    vi.useRealTimers();

    const job = await getDownloadJob(db, 't1');
    expect(job?.status).toBe('DOWNLOADING');
    expect(job?.bytesDownloaded).toBe(500);
    expect(job?.bytesTotal).toBe(1000);
  });

  it('pause cancels the system job and marks PAUSED', async () => {
    await service.enqueueDownload(db, { trackId: 't1', title: 'Track t1' });
    await service.pauseDownload(db, 't1');
    expect(mockNative.cancelDownload).toHaveBeenCalledWith('t1');
    const job = await getDownloadJob(db, 't1');
    expect(job?.status).toBe('PAUSED');
  });

  it('cancel removes the job', async () => {
    await service.enqueueDownload(db, { trackId: 't1', title: 'Track t1' });
    await service.cancelDownload(db, 't1');
    expect(await getDownloadJob(db, 't1')).toBeNull();
  });

  it('resume re-enqueues a paused job', async () => {
    await service.enqueueDownload(db, { trackId: 't1', title: 'Track t1' });
    await service.pauseDownload(db, 't1');
    const result = await service.resumeDownload(db, 't1');
    expect(result).toEqual({ ok: true });
    expect(mockNative.enqueueDownload).toHaveBeenCalledTimes(2);
  });

  it('reconciles a QUEUED job by starting it and fails a lost DOWNLOADING job', async () => {
    await enqueueDownloadJob(db, { trackId: 'q1', title: 'Queued' });
    await enqueueDownloadJob(db, { trackId: 'l1', title: 'Lost' });
    await patchDownloadJob(db, 'l1', { status: 'DOWNLOADING', startedAt: Date.now() });

    mockNative.queryProgress.mockResolvedValue({
      state: 'unknown',
      bytesDownloaded: 0,
      bytesTotal: 0,
    });
    await service.reconcileDownloads(db);

    expect(mockNative.enqueueDownload).toHaveBeenCalledWith('q1', expect.any(String), 'Queued');
    const lost = await getDownloadJob(db, 'l1');
    expect(lost?.status).toBe('FAILED');
    expect(lost?.errorCode).toBe('RECONCILE_LOST');
  });

  it('notifies once when a batch fully completes', async () => {
    mockNative.getFreeBytes.mockResolvedValue(1024 * 1024 * 1024);
    mockResolve.mockResolvedValue({
      track: { id: 't2', title: 'Track t2' },
      source: { type: 'remote', uri: 'https://cdn.example/t2.mp3', trackId: 't2' },
      confidence: 1,
      expiresAt: Date.now() + 60_000,
    } as never);
    await service.enqueueBatch(db, [
      { trackId: 't1', title: 'Track t1' },
      { trackId: 't2', title: 'Track t2' },
    ]);

    const sub = service.start(db);
    await emitEvent({
      trackId: 't1',
      state: 'completed',
      bytesDownloaded: 1,
      bytesTotal: 1,
      localUri: '/data/t1.mp3',
    });
    await emitEvent({
      trackId: 't2',
      state: 'completed',
      bytesDownloaded: 1,
      bytesTotal: 1,
      localUri: '/data/t2.mp3',
    });
    sub();

    expect(mockNative.notifyBatchComplete).toHaveBeenCalledTimes(1);
    expect(mockNative.notifyBatchComplete).toHaveBeenCalledWith(2);
  });

  it('clearCompleted removes terminal jobs and their files', async () => {
    await enqueueDownloadJob(db, { trackId: 't1', title: 'Track t1' });
    await patchDownloadJob(db, 't1', { status: 'COMPLETED', localUri: '/data/t1.mp3' });
    await enqueueDownloadJob(db, { trackId: 't2', title: 'Track t2' });

    const removed = await service.clearCompleted(db);
    expect(removed).toBe(1);
    expect(mockNative.deleteFile).toHaveBeenCalledWith('t1');
    expect(await downloadsQuery(db).fetch()).toHaveLength(1);
  });
});
