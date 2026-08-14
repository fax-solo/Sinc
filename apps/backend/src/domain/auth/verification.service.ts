import { createHash, randomBytes } from 'node:crypto';
import { ulid, UnauthorizedError, NotFoundError } from '@sinc/shared';
import type {
  VerificationTokenRecord,
  VerificationTokenRepository,
  VerificationKind,
} from './types.js';

export interface VerificationServiceOptions {
  verificationTokenRepository: VerificationTokenRepository;
  emailVerifyTtlHours: number;
  passwordResetTtlMinutes: number;
  now?: () => Date;
}

export interface IssuedVerification {
  token: string;
  expiresAt: string;
}

/**
 * Single-use, time-boxed, hashed-at-rest verification tokens used for both
 * email verification and password reset.
 */
export class VerificationService {
  private readonly repository: VerificationTokenRepository;
  private readonly emailVerifyTtlMs: number;
  private readonly passwordResetTtlMs: number;
  private readonly now: () => Date;

  constructor(options: VerificationServiceOptions) {
    this.repository = options.verificationTokenRepository;
    this.emailVerifyTtlMs = options.emailVerifyTtlHours * 60 * 60 * 1000;
    this.passwordResetTtlMs = options.passwordResetTtlMinutes * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(userId: string, kind: VerificationKind): Promise<IssuedVerification> {
    const token = randomBytes(32).toString('base64url');
    const ttlMs = kind === 'EMAIL_VERIFY' ? this.emailVerifyTtlMs : this.passwordResetTtlMs;
    const expiresAt = new Date(this.now().getTime() + ttlMs).toISOString();
    const record: VerificationTokenRecord = {
      id: ulid(),
      userId,
      kind,
      tokenHash: this.hashToken(token),
      expiresAt,
      usedAt: null,
      createdAt: this.now().toISOString(),
    };
    await this.repository.invalidateForUser(userId, kind);
    await this.repository.create(record);
    return { token, expiresAt };
  }

  /**
   * Validate a token for the given kind. Marks it used on success; a used,
   * expired, or unknown token is rejected without distinguishing which, so
   * the endpoint cannot be used for enumeration.
   */
  async consume(
    token: string,
    kind: VerificationKind,
  ): Promise<{ userId: string; expiresAt: string }> {
    const record = await this.repository.findByHash(this.hashToken(token));
    if (!record || record.kind !== kind) {
      throw new UnauthorizedError('Invalid or expired verification token');
    }
    if (record.usedAt) {
      throw new UnauthorizedError('Invalid or expired verification token');
    }
    if (new Date(record.expiresAt).getTime() <= this.now().getTime()) {
      throw new UnauthorizedError('Invalid or expired verification token');
    }
    await this.repository.markUsed(record.id, this.now().toISOString());
    return { userId: record.userId, expiresAt: record.expiresAt };
  }

  /** Invalidate pending tokens of a kind (e.g. before issuing a new one). */
  async invalidateForUser(userId: string, kind: VerificationKind): Promise<void> {
    await this.repository.invalidateForUser(userId, kind);
  }

  /** Look up a user-scoped token without consuming it (resend/refresh flows). */
  async findByHash(token: string): Promise<VerificationTokenRecord | null> {
    return this.repository.findByHash(this.hashToken(token));
  }
}

export function isTokenNotFound(err: unknown): boolean {
  return err instanceof NotFoundError;
}
