import { Database, Q, type Query } from '@nozbe/watermelondb';
import type { DownloadStatus, DownloadQuality } from '@sinc/shared';
import { Download } from './models';

const downloads = (db: Database) => db.collections.get<Download>('downloads');

export interface NewDownloadInput {
  trackId: string;
  title: string;
  artist?: string | null;
  artworkUrl?: string | null;
  quality?: DownloadQuality;
  priority?: number;
  batchId?: string | null;
}

export interface DownloadPatch {
  status?: DownloadStatus;
  progressPct?: number;
  bytesDownloaded?: number;
  bytesTotal?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  localUri?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
}

/** Creates the job (id = track id, one download per track) or no-ops if it exists. */
export async function enqueueDownloadJob(
  db: Database,
  input: NewDownloadInput,
): Promise<Download | null> {
  return db.write(async () => {
    const existing = await getDownloadJob(db, input.trackId);
    if (existing) return null;
    const now = Date.now();
    await db.batch(
      downloads(db).prepareCreateFromDirtyRaw({
        id: input.trackId,
        _status: 'created',
        _changed: '',
        title: input.title,
        artist: input.artist ?? null,
        artwork_url: input.artworkUrl ?? null,
        status: 'QUEUED',
        progress_pct: 0,
        bytes_downloaded: 0,
        bytes_total: null,
        error_code: null,
        error_message: null,
        quality: input.quality ?? 'high',
        priority: input.priority ?? 0,
        local_uri: null,
        batch_id: input.batchId ?? null,
        added_at: now,
        started_at: null,
        completed_at: null,
      }),
    );
    return downloads(db).find(input.trackId);
  });
}

export async function getDownloadJob(db: Database, trackId: string): Promise<Download | null> {
  return downloads(db)
    .find(trackId)
    .catch(() => null);
}

export async function patchDownloadJob(
  db: Database,
  trackId: string,
  patch: DownloadPatch,
): Promise<Download | null> {
  return db.write(async () => {
    const job = await getDownloadJob(db, trackId);
    if (!job) return null;
    return job.update((row) => {
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.progressPct !== undefined) row.progressPct = patch.progressPct;
      if (patch.bytesDownloaded !== undefined) row.bytesDownloaded = patch.bytesDownloaded;
      if (patch.bytesTotal !== undefined) row.bytesTotal = patch.bytesTotal;
      if (patch.errorCode !== undefined) row.errorCode = patch.errorCode;
      if (patch.errorMessage !== undefined) row.errorMessage = patch.errorMessage;
      if (patch.localUri !== undefined) row.localUri = patch.localUri;
      if (patch.startedAt !== undefined) row.startedAt = patch.startedAt;
      if (patch.completedAt !== undefined) row.completedAt = patch.completedAt;
    });
  });
}

export function downloadsQuery(db: Database, statuses?: DownloadStatus[]): Query<Download> {
  if (statuses && statuses.length > 0) {
    return downloads(db).query(Q.where('status', Q.oneOf(statuses)));
  }
  return downloads(db).query();
}

export async function completedDownloadUri(db: Database, trackId: string): Promise<string | null> {
  const job = await getDownloadJob(db, trackId);
  if (job?.status !== 'COMPLETED' || !job.localUri) return null;
  return job.localUri;
}

/** Deletes the job record. Callers must also delete the on-disk file via the native module. */
export async function removeDownloadJob(db: Database, trackId: string): Promise<boolean> {
  return db.write(async () => {
    const job = await getDownloadJob(db, trackId);
    if (!job) return false;
    await job.destroyPermanently();
    return true;
  });
}

export async function clearCompletedDownloads(db: Database): Promise<number> {
  return db.write(async () => {
    const completed = await downloads(db)
      .query(Q.where('status', Q.oneOf(['COMPLETED', 'FAILED', 'CANCELLED'])))
      .fetch();
    const removed = await Promise.all(completed.map((job) => job.destroyPermanently()));
    return removed.length;
  });
}
