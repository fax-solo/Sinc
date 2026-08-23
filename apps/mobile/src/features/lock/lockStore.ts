import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import {
  hashPin,
  savePinHash,
  clearPinHash,
  getPinHash,
  isValidPin,
} from '../../services/security/pin';
import { clearBiometricSecret } from '../../services/security/biometric';

interface LockState {
  /** The lock is armed (a PIN has been set). */
  enabled: boolean;
  /** Unlocked for the current foreground session. Never persisted. */
  unlocked: boolean;
  /** Sets + arms a new PIN. Returns false for invalid pins. */
  setPin: (pin: string) => boolean;
  /** True when the entered PIN matches. */
  verifyPin: (pin: string) => boolean;
  /** Unlocks the current session (biometric success path). */
  unlock: () => void;
  /** Re-arms the lock (app backgrounded or manual lock). */
  lock: () => void;
  /** Disarms the lock entirely and clears all secrets. */
  disable: () => void;
}

export const useLockStore = create<LockState>()(
  persist(
    (set) => ({
      enabled: false,
      unlocked: false,

      setPin: (pin) => {
        if (!isValidPin(pin)) return false;
        savePinHash(hashPin(pin));
        set({ enabled: true, unlocked: true });
        return true;
      },

      verifyPin: (pin) => {
        const stored = getPinHash();
        const matches = Boolean(stored) && stored === hashPin(pin);
        if (matches) set({ unlocked: true });
        return matches;
      },

      unlock: () => set({ unlocked: true }),

      lock: () => set({ unlocked: false }),

      disable: () => {
        clearPinHash();
        void clearBiometricSecret();
        set({ enabled: false, unlocked: true });
      },
    }),
    {
      name: STORAGE_KEYS.LOCK,
      storage: createJSONStorage(() => ({
        getItem: (key) => storage.getString(key),
        setItem: (key, value) => storage.setString(key, value),
        removeItem: (key) => storage.remove(key),
      })),
      partialize: (state) => ({ enabled: state.enabled }),
      onRehydrateStorage: () => (state) => {
        // A freshly rehydrated lock always starts locked.
        if (state?.enabled) useLockStore.setState({ unlocked: false });
      },
    }
  )
);
