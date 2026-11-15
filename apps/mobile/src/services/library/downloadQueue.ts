import type { CanonicalTrack } from '@sinc/shared';
import { isDownloadInProgress, useDownloadsStore } from './downloadsStore';

export interface QueueDownloadResult {
  queued: number;
  skipped: number;
}

/**
 * Queues a user-selected batch of songs. Completed downloads and jobs already
 * in the queue are skipped. Uses the existing bulk policy (direct sources
 * only), so a large selection cannot mass-trigger the on-device engine.
 */
export async function queueTracksForDownload(
  tracks: CanonicalTrack[]
): Promise<QueueDownloadResult> {
  let queued = 0;
  let skipped = 0;
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
    void store.downloadTrack(track, { priority: 'bulk' }).catch(() => undefined);
    queued += 1;
    // Start jobs at a short cadence so source resolution does not stampede.
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return { queued, skipped };
}
