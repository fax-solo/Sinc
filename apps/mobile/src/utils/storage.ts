/**
 * Storage abstraction. MMKV is the primary implementation; an in-memory
 * fallback keeps the module tree RN-free so it can be unit tested in Node.
 */

export interface KVStorage {
  getString(key: string): string | null;
  setString(key: string, value: string): void;
  remove(key: string): void;
  clear(): void;
  getObject<T>(key: string): T | null;
  setObject<T>(key: string, value: T): void;
}

export function createStorage(): KVStorage {
  try {
    // Lazy require keeps the module tree RN-free for unit tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MMKV } = require('react-native-mmkv') as {
      MMKV: new (opts: { id: string }) => MMKVLike;
    };
    if (!MMKV) throw new Error('MMKV unavailable');
    const mmkv = new MMKV({ id: 'sinc-storage' });

    return {
      getString: (key) => mmkv.getString(key) ?? null,
      setString: (key, value) => mmkv.set(key, value),
      remove: (key) => mmkv.delete(key),
      clear: () => mmkv.clearAll(),
      getObject: <T>(key: string) => {
        const val = mmkv.getString(key);
        return val ? (JSON.parse(val) as T) : null;
      },
      setObject: <T>(key: string, value: T) => mmkv.set(key, JSON.stringify(value)),
    };
  } catch {
    const memory = new Map<string, string>();
    return {
      getString: (key) => memory.get(key) ?? null,
      setString: (key, value) => memory.set(key, value),
      remove: (key) => memory.delete(key),
      clear: () => memory.clear(),
      getObject: <T>(key: string) => {
        const val = memory.get(key);
        return val ? (JSON.parse(val) as T) : null;
      },
      setObject: <T>(key: string, value: T) => memory.set(key, JSON.stringify(value)),
    };
  }
}

interface MMKVLike {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  clearAll(): void;
}

export const storage: KVStorage = createStorage();

export const STORAGE_KEYS = {
  SESSION: 'sinc.session',
  SETTINGS: 'sinc.settings',
  PLAYER: 'sinc.player',
  RECENT_SEARCHES: 'sinc.recentSearches',
  LIBRARY: 'sinc.library',
  DOWNLOADS: 'sinc.downloads',
  LYRICS: 'sinc.lyrics',
  LYRICS_OFFSETS: 'sinc.lyricsOffsets',
  SEARCH_CACHE: 'sinc.cache.search',
  HOME_CACHE: 'sinc.cache.home',
  PERSONALIZED_HOME_CACHE: 'sinc.cache.homePersonalized',
  LOCK: 'sinc.lock',
  ANALYTICS: 'sinc.analytics',
} as const;
