import { describe, it, expect, vi } from 'vitest';
import { createSecureStorage } from '../security/secureStorage';

describe('createSecureStorage', () => {
  it('falls back to in-memory storage when the keychain adapter is unavailable', async () => {
    // An adapter without the required methods triggers the fallback.
    const storage = createSecureStorage({} as never);
    expect(await storage.getItem('missing')).toBeNull();
    await storage.setItem('token', 'abc');
    expect(await storage.getItem('token')).toBe('abc');
    await storage.removeItem('token');
    expect(await storage.getItem('token')).toBeNull();
  });

  it('delegates to the keychain adapter when available', async () => {
    const calls: Array<{ op: string; key?: string; value?: string }> = [];
    const keychain = {
      getGenericPassword: vi.fn(async ({ service }: { service: string }) =>
        service === 'has-value' ? { service, value: 'secret' } : false,
      ),
      setGenericPassword: vi.fn(async (_u: string, value: string, opts: { service: string }) => {
        calls.push({ op: 'set', key: opts.service, value });
      }),
      resetGenericPassword: vi.fn(async ({ service }: { service: string }) => {
        calls.push({ op: 'reset', key: service });
      }),
    };

    const storage = createSecureStorage(keychain);
    expect(await storage.getItem('has-value')).toBe('secret');
    expect(await storage.getItem('empty')).toBeNull();
    expect(keychain.getGenericPassword).toHaveBeenCalledTimes(2);

    await storage.setItem('a', 'v');
    expect(calls).toContainEqual({ op: 'set', key: 'a', value: 'v' });
    await storage.removeItem('a');
    expect(calls).toContainEqual({ op: 'reset', key: 'a' });
  });
});
