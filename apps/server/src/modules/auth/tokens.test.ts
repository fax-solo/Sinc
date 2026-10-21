import { describe, expect, it } from 'vitest';
import { importPKCS8, SignJWT } from 'jose';
import { TokenService } from './tokens.js';
import { getEnv } from '../../config/env.js';
import { AuthenticationError } from '@sinc/shared';

const service = new TokenService();

async function signForTest(opts: {
  sub?: string;
  sid?: string;
  type?: string;
  expiresIn?: string | number;
  role?: string;
}): Promise<string> {
  const env = getEnv();
  const key = await importPKCS8(env.JWT_PRIVATE_KEY, 'RS256');
  const token = new SignJWT({
    sub: opts.sub ?? 'user-1',
    sid: opts.sid ?? 'session-1',
    type: opts.type ?? 'access',
    role: opts.role ?? 'user',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '15m');
  return token.sign(key);
}

describe('TokenService', () => {
  it('mints verifiable access tokens carrying identity', async () => {
    const token = await service.createAccessToken('user-1', 'session-1', 'admin', 'active');
    const payload = await service.verifyAccessToken(token);
    expect(payload).toMatchObject({
      sub: 'user-1',
      sid: 'session-1',
      type: 'access',
      role: 'admin',
      status: 'active',
    });
  });

  it('round-trips refresh tokens and distinguishes them from access tokens', async () => {
    const refresh = await service.createRefreshToken('user-1', 'session-1');
    const payload = await service.verifyRefreshToken(refresh);
    expect(payload).toMatchObject({ sub: 'user-1', sid: 'session-1', type: 'refresh' });
    expect((payload as { jti?: string }).jti).toBeTruthy();

    await expect(service.verifyAccessToken(refresh)).rejects.toBeInstanceOf(AuthenticationError);
    await expect(
      service.verifyRefreshToken(await service.createAccessToken('user-1', 'session-1'))
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects tampered signatures', async () => {
    const token = await signForTest({});
    const [head, , sig] = token.split('.');
    const forged = `${head}.${Buffer.from(JSON.stringify({ sub: 'hacker', sid: 's', type: 'access' })).toString('base64url')}.${sig}`;
    await expect(service.verifyAccessToken(forged)).rejects.toBeInstanceOf(AuthenticationError);
    await expect(service.verifyAccessToken('garbage.token.value')).rejects.toBeInstanceOf(
      AuthenticationError
    );
  });

  it('rejects expired tokens', async () => {
    const token = await signForTest({ expiresIn: -1 });
    await expect(service.verifyAccessToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });
});
