import { randomUUID } from 'node:crypto';
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';
import { AuthenticationError } from '@sinc/shared';
import { getEnv } from '../../config/env.js';
import type { UserRole, UserStatus } from '@sinc/shared';

interface AccessTokenPayload {
  sub: string;
  sid: string;
  type: 'access';
  role: UserRole;
  status: UserStatus;
}

interface RefreshTokenPayload {
  sub: string;
  sid: string;
  type: 'refresh';
}

export class TokenService {
  private privateKey!: CryptoKey;
  private publicKey!: CryptoKey;
  private keyPromise: Promise<void> | null = null;
  private accessTtl: string;
  private refreshTtl: string;

  constructor() {
    const env = getEnv();
    this.accessTtl = env.JWT_ACCESS_TTL;
    this.refreshTtl = env.JWT_REFRESH_TTL;
  }

  private async ensureKeys(): Promise<void> {
    if (!this.keyPromise) {
      const env = getEnv();
      this.keyPromise = Promise.all([
        importPKCS8(env.JWT_PRIVATE_KEY, 'RS256').then((key) => {
          this.privateKey = key;
        }),
        importSPKI(env.JWT_PUBLIC_KEY, 'RS256').then((key) => {
          this.publicKey = key;
        }),
      ]).then(() => undefined);
    }
    await this.keyPromise;
  }

  async createAccessToken(
    userId: string,
    sessionId: string,
    role: UserRole = 'user',
    status: UserStatus = 'active'
  ): Promise<string> {
    await this.ensureKeys();
    return new SignJWT({ sub: userId, sid: sessionId, type: 'access', role, status })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setExpirationTime(this.accessTtl)
      .sign(this.privateKey);
  }

  async createRefreshToken(userId: string, sessionId: string): Promise<string> {
    await this.ensureKeys();
    return new SignJWT({ sub: userId, sid: sessionId, jti: randomUUID(), type: 'refresh' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setExpirationTime(this.refreshTtl)
      .sign(this.privateKey);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    await this.ensureKeys();
    try {
      const { payload } = await jwtVerify(token, this.publicKey, { algorithms: ['RS256'] });
      if (payload.type !== 'access') throw new Error('Wrong token type');
      return payload as unknown as AccessTokenPayload;
    } catch {
      throw new AuthenticationError('Invalid or expired access token');
    }
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    await this.ensureKeys();
    try {
      const { payload } = await jwtVerify(token, this.publicKey, { algorithms: ['RS256'] });
      if (payload.type !== 'refresh') throw new Error('Wrong token type');
      return payload as unknown as RefreshTokenPayload;
    } catch {
      throw new AuthenticationError('Invalid or expired refresh token');
    }
  }
}
