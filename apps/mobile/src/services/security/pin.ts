/**
 * PIN storage for the app lock (M7.3). A salted FNV-1a hash is persisted so
 * the PIN is not stored in plain text. This is an *obfuscation barrier* for
 * casual access — for real security the biometric upgrade (see biometric.ts,
 * backed by the OS keystore) is the path. A per-install salt is generated
 * once and reused so the stored hash is not precomputed.
 */
import { storage } from '../../utils/storage';

const SALT_KEY = 'sinc.lock.salt';
const PIN_KEY = 'sinc.lock.pin';

function getSalt(): string {
  const existing = storage.getString(SALT_KEY);
  if (existing) return existing;
  const next = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  storage.setString(SALT_KEY, next);
  return next;
}

/** FNV-1a 32-bit over `salt:pin`, returned as hex. */
export function hashPin(pin: string): string {
  const input = `${getSalt()}:${pin}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function savePinHash(hash: string): void {
  storage.setString(PIN_KEY, hash);
}

export function clearPinHash(): void {
  storage.remove(PIN_KEY);
}

export function getPinHash(): string | null {
  return storage.getString(PIN_KEY);
}

/** A valid lock PIN is 4–6 digits. */
export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}
