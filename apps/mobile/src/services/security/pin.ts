/**
 * PIN storage for the app lock (M7.3). PINs are hashed with PBKDF2-HMAC-SHA256
 * (600k iterations, 16-byte CSPRNG salt) — an actual password KDF — so an
 * offline brute force of a 4–6 digit PIN is not practical. Providers are tried
 * in order: the native SincCrypto module (Android keystore-backed CPU work),
 * then WebCrypto, then a pure-JS fallback so hashing never bricks the lock.
 * Failed attempts are throttled with an exponential backoff (see lockout keys)
 * so an on-device attacker is slowed down as well.
 */
import { NativeModules } from 'react-native';
import { storage } from '../../utils/storage';
import { bytesToHex, pbkdf2Js } from './pbkdf2';

const SALT_KEY = 'sinc.lock.salt';
const PIN_KEY = 'sinc.lock.pin';
const ATTEMPTS_KEY = 'sinc.lock.attempts';
const LOCKOUT_UNTIL_KEY = 'sinc.lock.lockoutUntil';

const SALT_BYTES = 16;
const PBKDF2_ITERATIONS = 600_000;
const KEY_BYTES = 32;

/** Consecutive failures before the next attempt is blocked. */
export const MAX_ATTEMPTS = 5;
/** Backoff curve: lockout = min(BASE_MS * 2^(excess), CAP_MS). */
export const LOCKOUT_BASE_MS = 30_000;
export const LOCKOUT_CAP_MS = 15 * 60_000;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function nativeCrypto(): { pbkdf2?: unknown; randomBytes?: unknown } | undefined {
  return (NativeModules as { SincCrypto?: unknown }).SincCrypto as
    { pbkdf2?: unknown; randomBytes?: unknown } | undefined;
}

/** Cryptographically random salt from the native CSPRNG (or webcrypto). */
export async function generateSaltHex(): Promise<string> {
  const native = nativeCrypto();
  try {
    if (typeof native?.randomBytes === 'function') {
      const hex = await (native.randomBytes as (n: number) => Promise<string>)(SALT_BYTES);
      if (typeof hex === 'string' && hex.length === SALT_BYTES * 2) return hex;
    }
  } catch {
    // fall through
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const buf = new Uint8Array(SALT_BYTES);
    globalThis.crypto.getRandomValues(buf);
    return bytesToHex(buf);
  }
  // Last resort: no CSPRNG available. Mix multiple entropy sources; still
  // better than a fixed salt.
  const parts: number[] = [];
  for (let i = 0; i < SALT_BYTES; i += 1) {
    parts.push(Math.floor(Math.random() * 256) ^ (Date.now() & 0xff));
  }
  return bytesToHex(new Uint8Array(parts));
}

async function derivePbkdf2(password: string, saltHex: string): Promise<string> {
  const native = nativeCrypto();
  try {
    if (typeof native?.pbkdf2 === 'function') {
      const hex = await (
        native.pbkdf2 as (
          p: string,
          s: string,
          iterations: number,
          keyBytes: number
        ) => Promise<string>
      )(password, saltHex, PBKDF2_ITERATIONS, KEY_BYTES);
      if (typeof hex === 'string' && hex.length === KEY_BYTES * 2) return hex;
    }
  } catch {
    // fall through
  }
  const subtle =
    typeof globalThis.crypto?.subtle === 'object' &&
    typeof globalThis.crypto.subtle.importKey === 'function' &&
    typeof globalThis.crypto.subtle.deriveBits === 'function'
      ? globalThis.crypto.subtle
      : null;
  if (subtle) {
    const keyMaterial = await subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      KEY_BYTES * 8
    );
    return bytesToHex(new Uint8Array(bits));
  }
  return bytesToHex(pbkdf2Js(password, hexToBytes(saltHex), PBKDF2_ITERATIONS, KEY_BYTES));
}

/**
 * Memoized in-flight salt generation. The naive read-then-generate-then-write
 * raced: two concurrent hashPin() calls (double-tap Save on first setup) each
 * generated a different salt and both wrote — the stored PIN hash could then
 * be derived under a salt that no longer exists, rejecting the correct PIN
 * forever. Sharing one promise makes every caller derive under the same,
 * final salt.
 */
let saltGeneration: Promise<string> | null = null;

export async function getSalt(): Promise<string> {
  const existing = storage.getString(SALT_KEY);
  if (existing) return existing;
  saltGeneration ??= generateSaltHex()
    .then((next) => {
      storage.setString(SALT_KEY, next);
      return next;
    })
    .finally(() => {
      saltGeneration = null;
    });
  return saltGeneration;
}

/** PBKDF2 hash of `pin` under the stored per-install salt, returned as hex. */
export async function hashPin(pin: string): Promise<string> {
  const salt = await getSalt();
  return derivePbkdf2(pin, salt);
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

// --- Failed-attempt throttling -------------------------------------------------

export function getFailedAttempts(): number {
  const raw = storage.getString(ATTEMPTS_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export function recordFailedAttempt(): number {
  const next = getFailedAttempts() + 1;
  storage.setString(ATTEMPTS_KEY, String(next));
  if (next >= MAX_ATTEMPTS) {
    const excess = next - MAX_ATTEMPTS;
    const until = Date.now() + Math.min(LOCKOUT_BASE_MS * Math.pow(2, excess), LOCKOUT_CAP_MS);
    storage.setString(LOCKOUT_UNTIL_KEY, String(until));
  }
  return next;
}

export function resetFailedAttempts(): void {
  storage.remove(ATTEMPTS_KEY);
  storage.remove(LOCKOUT_UNTIL_KEY);
}

export function getLockoutRemainingMs(): number {
  const raw = storage.getString(LOCKOUT_UNTIL_KEY);
  const until = raw ? Number(raw) : 0;
  const remaining = until - Date.now();
  return remaining > 0 ? remaining : 0;
}

/** True while the lock is in a temporary backoff window. */
export function isLockedOut(): boolean {
  return getLockoutRemainingMs() > 0;
}
