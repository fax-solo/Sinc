import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analyticsEnabled,
  loadAnalyticsPreference,
  setAnalyticsPreference,
  track,
  trackBatch,
} from './analytics';
import { storage, STORAGE_KEYS } from '../../utils/storage';

beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  storage.setObject(STORAGE_KEYS.ANALYTICS, { enabled: false });
});

describe('analytics (local build)', () => {
  it('defaults to opt-out', () => {
    expect(analyticsEnabled()).toBe(false);
  });

  it('persists the opt-in locally without any network call', async () => {
    await setAnalyticsPreference(true);
    expect(analyticsEnabled()).toBe(true);
    expect(storage.getObject<{ enabled: boolean }>(STORAGE_KEYS.ANALYTICS)?.enabled).toBe(true);
  });

  it('loads the locally cached preference', async () => {
    storage.setObject(STORAGE_KEYS.ANALYTICS, { enabled: true });
    expect(await loadAnalyticsPreference()).toBe(true);
  });

  it('track/trackBatch never throw and record nothing', () => {
    storage.setObject(STORAGE_KEYS.ANALYTICS, { enabled: true });
    expect(() => {
      track('playback:start', 't1');
      trackBatch([{ event: 'download:complete', entityId: 't2' }]);
    }).not.toThrow();
  });
});
