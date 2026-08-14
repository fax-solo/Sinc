import { describe, it, expect } from 'vitest';
import { PasswordHasherService } from '../domain/auth/password.service.js';

describe('PasswordHasherService', () => {
  const hasher = new PasswordHasherService();

  it('hashes and verifies a password (argon2id)', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    expect(hash).not.toContain('correct');
    expect(hash.startsWith('$argon2')).toBe(true);
    expect(await hasher.verify(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    expect(await hasher.verify(hash, 'wrong password')).toBe(false);
  });

  it('produces unique hashes for the same password', async () => {
    const a = await hasher.hash('same-password');
    const b = await hasher.hash('same-password');
    expect(a).not.toBe(b);
  });

  it('verifies scrypt-format hashes (fallback path)', async () => {
    const service = new PasswordHasherService();
    const scryptHash = await (
      service as unknown as {
        scryptHash(password: string): Promise<string>;
      }
    ).scryptHash('fallback-password');
    expect(scryptHash.startsWith('scrypt$')).toBe(true);
    expect(await service.verify(scryptHash, 'fallback-password')).toBe(true);
    expect(await service.verify(scryptHash, 'nope')).toBe(false);
  });

  it('rejects malformed hashes', async () => {
    expect(await hasher.verify('not-a-hash', 'anything')).toBe(false);
  });
});
