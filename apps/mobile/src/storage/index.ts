/**
 * Storage abstraction. MMKV is the primary implementation (see
 * ARCHITECTURE_MOBILE.md); an in-memory fallback keeps the JS layer testable
 * and keeps the app functional when the native module is unavailable.
 */

export interface KVStorage {
  getString(key: string): string | null;
  setString(key: string, value: string): void;
  remove(key: string): void;
  clear(): void;
}

export function createStorage(): KVStorage {
  try {
    // Lazy require keeps the module tree RN-free for unit tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const MMKV = require('react-native-mmkv').MMKV;
    if (!MMKV) throw new Error('MMKV unavailable');
    const mmkv = new MMKV({ id: 'sinc-storage' });
    return {
      getString: (key) => mmkv.getString(key) ?? null,
      setString: (key, value) => mmkv.set(key, value),
      remove: (key) => mmkv.delete(key),
      clear: () => mmkv.clearAll(),
    };
  } catch {
    const memory = new Map<string, string>();
    return {
      getString: (key) => memory.get(key) ?? null,
      setString: (key, value) => memory.set(key, value),
      remove: (key) => memory.delete(key),
      clear: () => memory.clear(),
    };
  }
}

export const storage: KVStorage = createStorage();

export const STORAGE_KEYS = {
  AUTH: 'sinc.auth',
  SETTINGS: 'sinc.settings',
  NAV_STATE: 'sinc.navState',
  PLAYER: 'sinc.player',
} as const;
