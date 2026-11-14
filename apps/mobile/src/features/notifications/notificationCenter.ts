/**
 * Bridges real app events into the in-app notification centre. The native
 * notification channel already covers updates; this feed is the in-app history
 * shown behind the Home bell.
 */
import { useDownloadsStore, type DownloadPhase } from '../../services/library/downloadsStore';
import { useUpdateStore } from '../updates/updateStore';
import { usePreferencesStore } from '../preferences/preferencesStore';
import { useNotificationStore } from './notificationStore';

let started = false;
const seenDownloadPhases = new Map<string, DownloadPhase>();

function syncDownloads(
  state: ReturnType<typeof useDownloadsStore.getState>,
  notify: boolean
): void {
  for (const record of state.downloads) {
    const previous = seenDownloadPhases.get(record.jobId);
    seenDownloadPhases.set(record.jobId, record.phase);
    if (!notify || previous === record.phase) continue;
    if (record.phase === 'completed') {
      if (!usePreferencesStore.getState().notifications.downloads) continue;
      useNotificationStore.getState().add({
        id: `download-complete-${record.jobId}`,
        kind: 'download',
        title: 'Download complete',
        body: `${record.track.title} is ready offline.`,
        action: { type: 'downloads' },
      });
    } else if (record.phase === 'failed') {
      if (!usePreferencesStore.getState().notifications.downloads) continue;
      useNotificationStore.getState().add({
        id: `download-failed-${record.jobId}`,
        kind: 'download',
        title: 'Download failed',
        body: record.error
          ? `${record.track.title}: ${record.error}`
          : `${record.track.title} could not be downloaded.`,
        action: { type: 'downloads' },
      });
    }
  }
}

function syncUpdate(state: ReturnType<typeof useUpdateStore.getState>): void {
  if (state.softStatus !== 'available' || !state.latest) return;
  if (!usePreferencesStore.getState().notifications.updates) return;
  const latest = state.latest;
  useNotificationStore.getState().add({
    id: `update-${latest.versionName}`,
    kind: 'update',
    title: 'Update available',
    body: `Sinc ${latest.versionName} is ready to install.`,
    action: { type: 'updates' },
  });
}

/** Idempotent; safe to call from the app root on every mount. */
export function initNotificationCenter(): void {
  if (started) return;
  started = true;

  // Seed known phases so a cold start does not replay old download events.
  syncDownloads(useDownloadsStore.getState(), false);
  syncUpdate(useUpdateStore.getState());

  useDownloadsStore.subscribe((state) => syncDownloads(state, true));
  useUpdateStore.subscribe((state) => syncUpdate(state));
}
