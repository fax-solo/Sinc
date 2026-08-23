import { createHmac, randomBytes } from 'node:crypto';

/**
 * Minimal RFC 6238 TOTP (HMAC-SHA1, 30s step, 6 digits) with a ±1 step
 * window. Deliberately dependency-free: enrollment secrets are generated as
 * base32 (RFC 4648) so they can be pasted into any authenticator app
 * (Google Authenticator, Authy, 1Password, ...).
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;
const DIGITS = 6;

export function generateTotpSecret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(secret: string): Buffer {
  const cleaned = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

export function totpCode(secret: string, atMs = Date.now()): string {
  const counter = BigInt.asUintN(64, BigInt(Math.floor(atMs / STEP_MS)));
  const key = base32Decode(secret);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(counter);
  const hmac = createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS)
    .toString()
    .padStart(DIGITS, '0');
  return code;
}

export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  for (let step = -1; step <= 1; step += 1) {
    if (totpCode(secret, atMs + step * STEP_MS) === code) return true;
  }
  return false;
}

/** otpauth:// provisioning URI for QR codes (user pastes into an authenticator). */
export function otpauthUri(secret: string, account: string, issuer = 'Sinc'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
