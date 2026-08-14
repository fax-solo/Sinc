import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, generateKeyPair, importPKCS8, importSPKI, exportJWK } from 'jose';
import type { Role } from '@sinc/shared';
import type { AccessTokenClaims, IssuedAccessToken, TokenService } from './types.js';

const JWT_ISSUER = 'sinc-api';
const JWT_AUDIENCE = 'sinc-mobile';
const REFRESH_BYTES = 32;

/** jose v6 uses WebCrypto keys; derive the exact type from its signatures. */
type SigningKey = Awaited<ReturnType<typeof importPKCS8>>;

/**
 * RS256 asymmetric access tokens (15 min) + opaque 256-bit refresh tokens.
 * Refresh tokens are never persisted - only their SHA-256 hash is stored.
 * When no PEM keys are configured (dev), an ephemeral keypair is generated.
 */
export class TokenServiceJose implements TokenService {
  private privateKey: SigningKey | null = null;
  private publicKey: SigningKey | null = null;
  private readonly accessTtlSeconds: number;

  constructor(
    private readonly privateKeyPem: string | undefined,
    private readonly publicKeyPem: string | undefined,
    accessTtlSeconds: number,
  ) {
    this.accessTtlSeconds = accessTtlSeconds;
  }

  private async ensureKeys(): Promise<{ privateKey: SigningKey; publicKey: SigningKey }> {
    if (this.privateKey && this.publicKey) {
      return { privateKey: this.privateKey, publicKey: this.publicKey };
    }
    if (this.privateKeyPem && this.publicKeyPem) {
      const [privateKey, publicKey] = await Promise.all([
        importPKCS8(this.privateKeyPem, 'RS256'),
        importSPKI(this.publicKeyPem, 'RS256'),
      ]);
      this.privateKey = privateKey;
      this.publicKey = publicKey;
    } else {
      const { publicKey, privateKey } = await generateKeyPair('RS256', {
        extractable: true,
      });
      this.privateKey = privateKey;
      this.publicKey = publicKey;
      if (process.env.NODE_ENV !== 'test') {
        process.emitWarning(
          'JWT_ACCESS_PRIVATE_KEY not set - using ephemeral RS256 keypair; ' +
            'tokens will be invalid after restart.',
        );
      }
    }
    return { privateKey: this.privateKey, publicKey: this.publicKey };
  }

  async issueAccessToken(userId: string, role: Role): Promise<IssuedAccessToken> {
    const { privateKey } = await this.ensureKeys();
    const jti = randomBytes(16).toString('hex');
    const token = await new SignJWT({ role })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(userId)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtlSeconds}s`)
      .sign(privateKey);
    return { token, jti, expiresIn: this.accessTtlSeconds };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    try {
      const { publicKey } = await this.ensureKeys();
      const { payload } = await jwtVerify(token, publicKey, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      if (!payload.sub || !payload.jti || typeof payload.exp !== 'number') {
        return null;
      }
      return {
        sub: payload.sub,
        role: (payload.role as Role) ?? 'USER',
        jti: payload.jti,
        exp: payload.exp,
      };
    } catch {
      return null;
    }
  }

  issueRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(REFRESH_BYTES).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Export the current public key as JWK (for debugging/verification docs). */
  async exportPublicJwk(): Promise<Record<string, unknown> | null> {
    try {
      const { publicKey } = await this.ensureKeys();
      return await exportJWK(publicKey);
    } catch {
      return null;
    }
  }
}
