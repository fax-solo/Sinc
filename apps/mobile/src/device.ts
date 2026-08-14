/**
 * Device context for API headers (X-Device-Id / X-Platform).
 * The device id is stable per install; a persisted UUID is used when the
 * native device-info module is unavailable.
 */
import { storage, STORAGE_KEYS } from './storage';

const STORAGE_DEVICE_ID_KEY = `${STORAGE_KEYS.AUTH}.deviceId`;

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function platformName(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native');
    return Platform.OS ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function getDeviceContext(): { 'x-device-id': string; 'x-platform': string } {
  let deviceId = storage.getString(STORAGE_DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = randomId();
    storage.setString(STORAGE_DEVICE_ID_KEY, deviceId);
  }
  return { 'x-device-id': deviceId, 'x-platform': platformName() };
}
