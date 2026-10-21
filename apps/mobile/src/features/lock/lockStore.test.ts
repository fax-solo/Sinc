import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { getPinHash, getFailedAttempts } from '../../services/security/pin';
import { useLockStore } from './lockStore';

vi.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whitelist' },
  ACCESS_CONTROL: { BIOMETRY_CURRENT_SET: 'biometryCurrentSet' },
  getSupportedBiometryType: vi.fn(async () => null),
  setGenericPassword: vi.fn(async () => ({ service: 'x', storage: 'keychain' })),
  getGenericPassword: vi.fn(async () => false),
  resetGenericPassword: vi.fn(async () => true),
}));

function clearState() {
  storage.remove(STORAGE_KEYS.LOCK);
  storage.remove('sinc.lock.salt');
  storage.remove('sinc.lock.pin');
  storage.remove('sinc.lock.attempts');
  storage.remove('sinc.lock.lockoutUntil');
  useLockStore.setState({ enabled: false, unlocked: false });
}

beforeEach(() => {
  clearState();
});

describe('lockStore', () => {
  it('arms the lock with a valid PIN and stores a KDF digest', async () => {
    const ok = await useLockStore.getState().setPin('1234');
    expect(ok).toBe(true);
    const state = useLockStore.getState();
    expect(state.enabled).toBe(true);
    expect(state.unlocked).toBe(true);
    const stored = getPinHash();
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toBe('1234');
  });

  it('rejects an invalid PIN without arming the lock', async () => {
    const ok = await useLockStore.getState().setPin('123');
    expect(ok).toBe(false);
    const state = useLockStore.getState();
    expect(state.enabled).toBe(false);
    expect(getPinHash()).toBeNull();
  });

  it('unlocks when the correct PIN is entered', async () => {
    await useLockStore.getState().setPin('4321');
    useLockStore.setState({ unlocked: false });
    const ok = await useLockStore.getState().verifyPin('4321');
    expect(ok).toBe(true);
    expect(useLockStore.getState().unlocked).toBe(true);
  });

  it('stays locked on a wrong PIN and counts the failure', async () => {
    await useLockStore.getState().setPin('4321');
    useLockStore.setState({ unlocked: false });
    const ok = await useLockStore.getState().verifyPin('9999');
    expect(ok).toBe(false);
    expect(useLockStore.getState().unlocked).toBe(false);
    expect(getFailedAttempts()).toBe(1);
  });

  it('locks out after MAX_ATTEMPTS consecutive failures', async () => {
    await useLockStore.getState().setPin('4321');
    for (let i = 0; i < 5; i += 1) {
      await useLockStore.getState().verifyPin('9999');
    }
    const { isLockedOut } = await import('../../services/security/pin');
    expect(isLockedOut()).toBe(true);
    const ok = await useLockStore.getState().verifyPin('4321');
    expect(ok).toBe(false);
  });

  it('a correct PIN resets the failure counter', async () => {
    await useLockStore.getState().setPin('4321');
    useLockStore.setState({ unlocked: false });
    await useLockStore.getState().verifyPin('1111');
    useLockStore.setState({ unlocked: false });
    await useLockStore.getState().verifyPin('1111');
    expect(getFailedAttempts()).toBe(2);
    useLockStore.setState({ unlocked: false });
    await useLockStore.getState().verifyPin('4321');
    expect(getFailedAttempts()).toBe(0);
  });

  it('disable clears the PIN digest and unlocks', async () => {
    await useLockStore.getState().setPin('1234');
    useLockStore.getState().disable();
    const state = useLockStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.unlocked).toBe(true);
    expect(getPinHash()).toBeNull();
  });

  it('lock re-arms a previously unlocked session', async () => {
    await useLockStore.getState().setPin('1234');
    useLockStore.getState().lock();
    expect(useLockStore.getState().unlocked).toBe(false);
  });
});
