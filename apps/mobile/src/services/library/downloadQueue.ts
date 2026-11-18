import type { CanonicalTrack } from '@sinc/shared';
import {
  type DownloadPriority,
  isDownloadInProgress,
  useDownloadsStore,
} from './downloadsStore';

export interface QueueDownloadResult {
  queued: number;
  skipped: number;
}

export interface QueueDownloadOptions {
  allowEngine?: boolean;
  priority?: DownloadPriority;
}

/**
 * Queues a user-selected batch of songs. Completed downloads and jobs already
 * in the queue are skipped. Concurrency is capped by the store scheduler
 * (MAX_CONCURRENT_DOWNLOADS = 2). Allows engine fallback by default so batch
 * selections download reliably when direct sources are not available.
 */
export async function queueTracksForDownload(
  tracks: CanonicalTrack[],
  opts?: QueueDownloadOptions
): Promise<QueueDownloadResult> {
  let queued = 0;
  let skipped = 0;
  const allowEngine = opts?.allowEngine ?? true;
  const priority = opts?.priority ?? 'bulk';
  for (const track of tracks) {
    const store = useDownloadsStore.getState();
    const existing = store.getDownload(track.id);
    if (
      (existing?.phase === 'completed' && existing.localUri) ||
      (existing && isDownloadInProgress(existing.phase))
    ) {
      skipped += 1;
      continue;
    }
    void store.downloadTrack(track, { priority, allowEngine }).catch(() => undefined);
    queued += 1;
    // Start jobs at a short cadence so source resolution does not stampede.
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return { queued, skipped };
}
