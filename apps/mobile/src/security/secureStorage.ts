/**
 * Secure storage for credentials (access/refresh tokens).
 *
 * Production: iOS Keychain / Android Keystore via react-native-keychain.
 * Fallback: in-memory map so the JS layer stays testable and the app
 * remains functional when the native module is unavailable (dev/test).
 *
 * The API is async because Keychain reads are async.
 */

export interface SecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface KeychainResult {
  value?: string;
  service?: string;
}

interface KeychainLike {
  getGenericPassword(opts?: unknown): Promise<KeychainResult | false>;
  setGenericPassword(username: string, value: string, opts?: unknown): Promise<unknown>;
  resetGenericPassword(opts?: unknown): Promise<unknown>;
}

export function createSecureStorage(keychain?: KeychainLike): SecureStorage {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const adapter: KeychainLike = keychain ?? require('react-native-keychain');
    if (!adapter?.setGenericPassword) throw new Error('Keychain unavailable');
    return {
      async getItem(key) {
        const result = await adapter.getGenericPassword({ service: key });
        return result ? (result.value ?? null) : null;
      },
      async setItem(key, value) {
        await adapter.setGenericPassword('sinc', value, {
          service: key,
          accessible: 'kSecAttrAccessibleWhenUnlockedThisDeviceOnly',
        });
      },
      async removeItem(key) {
        await adapter.resetGenericPassword({ service: key });
      },
    };
  } catch {
    const memory = new Map<string, string>();
    return {
      async getItem(key) {
        return memory.get(key) ?? null;
      },
      async setItem(key, value) {
        memory.set(key, value);
      },
      async removeItem(key) {
        memory.delete(key);
      },
    };
  }
}

export const secureStorage: SecureStorage = createSecureStorage();

export const SECURE_KEYS = {
  ACCESS_TOKEN: 'sinc.accessToken',
  REFRESH_TOKEN: 'sinc.refreshToken',
} as const;
