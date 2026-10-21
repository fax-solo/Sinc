/**
 * Local-only usage analytics. The opt-in preference is stored in MMKV; event
 * recording is intentionally a no-op — nothing is ever uploaded, since the
 * local build has no backend and analytics would leave the device. Call sites
 * stay unchanged so enabling/disabling stays a local toggle only.
 */
import { storage, STORAGE_KEYS } from '../../utils/storage';

export const ANALYTICS_EVENTS = [
  'search:success',
  'playback:start',
  'playback:complete',
  'download:complete',
  'download:failed',
  'lyrics:matched',
  'lyrics:missed',
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

/** Returns the locally cached preference (local build: no server to sync). */
export async function loadAnalyticsPreference(): Promise<boolean> {
  return readPreference().enabled;
}

/** Persists the opt-in preference locally. */
export async function setAnalyticsPreference(enabled: boolean): Promise<boolean> {
  storage.setObject(STORAGE_KEYS.ANALYTICS, { enabled });
  return enabled;
}

/**
 * Event recording is a no-op in the local build (nothing leaves the device).
 * Kept as a fire-and-forget function so existing call sites don't change.
 */
export function track(
  _event: AnalyticsEvent,
  _entityId?: string,
  _meta?: Record<string, string | number | boolean>
): void {}

/** No-op batch recording, mirroring `track` for the same reason. */
export function trackBatch(_events: AnalyticsEventInput[]): void {}
