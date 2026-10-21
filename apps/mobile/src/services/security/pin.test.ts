import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pbkdf2Js, sha256, bytesToHex } from './pbkdf2';
import { storage } from '../../utils/storage';
import {
  hashPin,
  generateSaltHex,
  getPinHash,
  savePinHash,
  clearPinHash,
  isValidPin,
  getFailedAttempts,
  recordFailedAttempt,
  resetFailedAttempts,
  getLockoutRemainingMs,
  MAX_ATTEMPTS,
  getSalt,
} from './pin';

const keys = ['sinc.lock.salt', 'sinc.lock.pin', 'sinc.lock.attempts', 'sinc.lock.lockoutUntil'];

function clearLockKeys() {
  for (const key of keys) storage.remove(key);
}

beforeEach(() => {
  clearLockKeys();
});

afterAll(() => {
  vi.useRealTimers();
});

describe('pbkdf2Js (pure-JS fallback)', () => {
  it('passes the RFC 7914 PBKDF2-HMAC-SHA256 test vector', () => {
    const salt = new TextEncoder().encode('salt');
    const dk = pbkdf2Js('password', salt, 1, 32);
    expect(bytesToHex(dk)).toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
  });

  it('produces different output when the password changes', () => {
    const salt = new TextEncoder().encode('salt');
    const a = bytesToHex(pbkdf2Js('password', salt, 1, 32));
    const b = bytesToHex(pbkdf2Js('password1', salt, 1, 32));
    expect(a).not.toBe(b);
  });

  it('sha256 matches the empty-string digest', () => {
    const digest = sha256(new Uint8Array(0));
    expect(bytesToHex(digest)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});

describe('hashPin (KDF through storage salt)', () => {
  it('generates distinct CSPRNG salts', async () => {
    const a = await generateSaltHex();
    const b = await generateSaltHex();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it('hashes autokey the same PIN consistently for the same salt', async () => {
    clearLockKeys();
    const h1 = await hashPin('1234');
    const salt = await getSalt();
    const h2 = await hashPin('1234');
    expect(h1).toBe(h2);
    expect(salt).toBeTruthy();
  });

  it('uses a per-install salt, so identical PINs hash differently across installs', async () => {
    clearLockKeys();
    const first = await hashPin('0000');
    const saltA = await getSalt();
    storage.remove('sinc.lock.salt');
    const second = await hashPin('0000');
    const saltB = await getSalt();
    expect(saltA).not.toBe(saltB);
    expect(first).not.toBe(second);
  });

  it('produces different digests for different PINs on one install', async () => {
    clearLockKeys();
    const a = await hashPin('1234');
    const b = await hashPin('4321');
    expect(a).not.toBe(b);
  });

  it('stores and clears the digest via savePinHash/getPinHash/clearPinHash', () => {
    savePinHash('deadbeef');
    expect(getPinHash()).toBe('deadbeef');
    clearPinHash();
    expect(getPinHash()).toBeNull();
  });

  it('validates 4-6 digit PINs only', () => {
    expect(isValidPin('0000')).toBe(true);
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('1234567')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });
});

describe('failed-attempt throttling', () => {
  it('tracks consecutive failures', () => {
    expect(getFailedAttempts()).toBe(0);
    recordFailedAttempt();
    recordFailedAttempt();
    expect(getFailedAttempts()).toBe(2);
  });

  it('starts a lockout window once MAX_ATTEMPTS is hit', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordFailedAttempt();
    expect(getFailedAttempts()).toBe(MAX_ATTEMPTS);
    expect(getLockoutRemainingMs()).toBeGreaterThan(0);
  });

  it('escapes the lockout window after time passes and reset clears it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordFailedAttempt();
    const remaining = getLockoutRemainingMs();
    vi.advanceTimersByTime(remaining + 1000);
    expect(getLockoutRemainingMs()).toBe(0);
    resetFailedAttempts();
    expect(getFailedAttempts()).toBe(0);
    expect(getLockoutRemainingMs()).toBe(0);
  });
});

describe('real-clock hashPin', () => {
  it('round-trips under actual (real) timers', async () => {
    const h = await hashPin('4821');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
