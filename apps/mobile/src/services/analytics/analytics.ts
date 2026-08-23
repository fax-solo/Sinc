/**
 * Opt-in, privacy-clean usage analytics client. Mirrors the server's allowlist
 * (`apps/server/src/modules/analytics`). No query text, no titles, no PII is
 * ever sent — only an event name, an optional entity id and tiny scalar
 * metadata. Events are dropped entirely unless the user has opted in; the
 * preference is cached locally and re-synced from the server on demand.
 */
import { apiClient } from '../../api/client';
import { storage, STORAGE_KEYS } from '../../utils/storage';

export const ANALYTICS_EVENTS = [
  'search:success',
  'playback:start',
  'playback:complete',
  'download:complete',
  'lyrics:matched',
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

interface AnalyticsPreference {
  enabled: boolean;
}

interface AnalyticsEventInput {
  event: AnalyticsEvent;
  entityId?: string;
  meta?: Record<string, string | number | boolean>;
}

function readPreference(): AnalyticsPreference {
  return storage.getObject<AnalyticsPreference>(STORAGE_KEYS.ANALYTICS) ?? { enabled: false };
}

/** Sync read of the locally cached preference (no network). */
export function analyticsEnabled(): boolean {
  return readPreference().enabled;
}

/** Re-fetches the opt-in preference from the server and caches it. */
export async function loadAnalyticsPreference(): Promise<boolean> {
  try {
    const prefs = await apiClient.get<AnalyticsPreference>('/analytics/preferences');
    storage.setObject(STORAGE_KEYS.ANALYTICS, prefs);
    return prefs.enabled;
  } catch {
    return readPreference().enabled;
  }
}

/** Persists the opt-in preference on the server and locally. */
export async function setAnalyticsPreference(enabled: boolean): Promise<boolean> {
  try {
    const prefs = await apiClient.put<AnalyticsPreference>('/analytics/preferences', { enabled });
    storage.setObject(STORAGE_KEYS.ANALYTICS, prefs);
    return prefs.enabled;
  } catch {
    storage.setObject(STORAGE_KEYS.ANALYTICS, { enabled });
    return enabled;
  }
}

/**
 * Fire-and-forget event recording. Never throws, never blocks: failures are
 * swallowed so analytics can never degrade the app experience.
 */
export function track(
  event: AnalyticsEvent,
  entityId?: string,
  meta?: Record<string, string | number | boolean>
): void {
  if (!readPreference().enabled) return;
  void apiClient
    .post('/analytics/events', { events: [{ event, entityId, meta }] })
    .catch(() => undefined);
}

/** Queues a batch of events in a single request. */
export function trackBatch(events: AnalyticsEventInput[]): void {
  if (!readPreference().enabled || events.length === 0) return;
  void apiClient.post('/analytics/events', { events }).catch(() => undefined);
}
