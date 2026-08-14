import { timingSafeEqual, scrypt as scryptCb, randomBytes } from 'node:crypto';
import type { PasswordHasher } from './types.js';

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * Argon2id (OWASP-recommended: 64MB, t=3, p=4) with automatic scrypt fallback
 * when the native module is unavailable. The scrypt hash is self-describing
 * (scrypt$N$r$p$salt$hash) so both schemes can be verified interchangeably.
 */
export class PasswordHasherService implements PasswordHasher {
  private readonly argon2: typeof import('argon2') | null;

  constructor() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.argon2 = require('argon2');
    } catch {
      this.argon2 = null;
    }
  }

  async hash(password: string): Promise<string> {
    if (this.argon2) {
      return this.argon2.hash(password, {
        type: this.argon2.argon2id,
        memoryCost: 64 * 1024,
        timeCost: 3,
        parallelism: 4,
      });
    }
    return this.scryptHash(password);
  }

  async verify(stored: string, password: string): Promise<boolean> {
    if (stored.startsWith('$argon2')) {
      if (!this.argon2) return false;
      try {
        return await this.argon2.verify(stored, password);
      } catch {
        return false;
      }
    }
    if (stored.startsWith('scrypt$')) {
      return this.scryptVerify(stored, password);
    }
    return false;
  }

  private async scryptHash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const N = 2 ** 14;
    const r = 8;
    const p = 1;
    const keyLen = 64;
    const derived = await scrypt(password, salt, keyLen, { N, r, p });
    return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  private async scryptVerify(stored: string, password: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6) return false;
    const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
    const N = Number(nStr);
    const r = Number(rStr);
    const p = Number(pStr);
    const salt = Buffer.from(saltB64!, 'base64');
    const expected = Buffer.from(hashB64!, 'base64');
    const derived = await scrypt(password, salt, expected.length, { N, r, p });
    return timingSafeEqual(derived, expected);
  }
}
