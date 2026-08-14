import { describe, it, expect } from 'vitest';
import { generateKeyPair } from 'jose';
import { TokenServiceJose } from '../domain/auth/token.service.js';

async function makeService() {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const service = new TokenServiceJose(
    await (await import('jose')).exportPKCS8(privateKey),
    await (await import('jose')).exportSPKI(publicKey),
    900,
  );
  return service;
}

describe('TokenServiceJose', () => {
  it('issues an RS256 access token with expected claims', async () => {
    const service = await makeService();
    const issued = await service.issueAccessToken('user_1', 'ADMIN');
    expect(issued.expiresIn).toBe(900);
    expect(issued.jti).toBeTruthy();

    const parts = issued.token.split('.');
    expect(parts).toHaveLength(3);
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
    expect(header.alg).toBe('RS256');
  });

  it('verifies a valid token and returns claims', async () => {
    const service = await makeService();
    const issued = await service.issueAccessToken('user_1', 'USER');
    const claims = await service.verifyAccessToken(issued.token);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe('user_1');
    expect(claims!.role).toBe('USER');
    expect(claims!.jti).toBe(issued.jti);
  });

  it('rejects a token signed by a different key', async () => {
    const serviceA = await makeService();
    const serviceB = await makeService();
    const issued = await serviceA.issueAccessToken('user_1', 'USER');
    const claims = await serviceB.verifyAccessToken(issued.token);
    expect(claims).toBeNull();
  });

  it('rejects garbage and empty tokens', async () => {
    const service = await makeService();
    expect(await service.verifyAccessToken('garbage')).toBeNull();
    expect(await service.verifyAccessToken('')).toBeNull();
  });

  it('issues opaque refresh tokens with hashes', async () => {
    const service = await makeService();
    const { token, hash } = service.issueRefreshToken();
    expect(token).not.toBe(hash);
    expect(service.hashRefreshToken(token)).toBe(hash);
    // hash is hex sha256 (64 chars)
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes are deterministic and raw tokens are never stored', async () => {
    const service = await makeService();
    const { token } = service.issueRefreshToken();
    expect(service.hashRefreshToken(token)).toBe(service.hashRefreshToken(token));
    expect(hashContainsToken(token, service.hashRefreshToken(token))).toBe(false);
  });
});

function hashContainsToken(token: string, hash: string): boolean {
  return hash.includes(token) || token.includes(hash);
}
