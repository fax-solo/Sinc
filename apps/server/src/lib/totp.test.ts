import { describe, expect, it } from 'vitest';
import { generateTotpSecret, otpauthUri, totpCode, verifyTotp } from './totp.js';

describe('totp', () => {
  it('generates base32 secrets of the expected length', () => {
    const secret = generateTotpSecret(20);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  it('produces a stable 6-digit code for a fixed time', () => {
    // RFC 6238 test vector: SHA1, secret "12345678901234567890" (base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ), T=59
    // The RFC value is 8 digits ("94287082"); our 6-digit code is the truncation.
    const at = 59 * 1000;
    expect(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', at)).toBe('287082');
  });

  it('verifies a code within the 30s window (tolerance ±1 step)', () => {
    const secret = generateTotpSecret();
    const code = totpCode(secret, 60_000);
    expect(verifyTotp(secret, code, 60_000)).toBe(true);
    expect(verifyTotp(secret, code, 60_000 - 30_000)).toBe(true);
    expect(verifyTotp(secret, code, 60_000 + 30_000)).toBe(true);
    expect(verifyTotp(secret, code, 60_000 - 90_000)).toBe(false);
  });

  it('rejects malformed or wrong codes', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, 'abc123')).toBe(false);
    expect(verifyTotp(secret, '000000')).toBe(false);
  });

  it('builds an otpauth provisioning URI', () => {
    const uri = otpauthUri('SECRET', 'admin@sinc.dev');
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('secret=SECRET');
    expect(uri).toContain('issuer=Sinc');
    expect(uri).toContain('Sinc%3Aadmin%40sinc.dev');
  });
});
