/**
 * Auth domain contracts. Repositories are implemented over Prisma in
 * production and over in-memory stores in tests, so the full auth lifecycle
 * (incl. token reuse detection) is testable without a database.
 */

import type { Role, UserStatus } from '@sinc/shared';

// ---------- Records (DB-shaped, provider-agnostic) ----------

export interface UserRecord {
  id: string;
  email: string;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  passwordHash: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  avatarObjectKey: string | null;
  role: Role;
  status: UserStatus;
  statusReason: string | null;
  locale: string;
  themePreference: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  createdAt: string;
  deletedAt: string | null;
}

export interface UserSettingsRecord {
  playback: Record<string, unknown>;
  downloads: Record<string, unknown>;
  lyrics: Record<string, unknown>;
  appearance: Record<string, unknown>;
  privacy: Record<string, unknown>;
  security: Record<string, unknown>;
  dataSaver: Record<string, unknown>;
}

export interface SessionRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  deviceId: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
  lastUsedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface DeviceRecord {
  id: string;
  userId: string;
  platform: string;
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
  lastSeenAt: string;
  createdAt: string;
}

export type VerificationKind = 'EMAIL_VERIFY' | 'PASSWORD_RESET';

export interface VerificationTokenRecord {
  id: string;
  userId: string;
  kind: VerificationKind;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  categoryId: string;
}

// ---------- Repository contracts ----------

export interface CreateUserInput {
  id: string;
  email: string;
  passwordHash: string;
  username: string;
  displayName: string | null;
  locale: string;
  role?: Role;
}

export interface UserRepository {
  create(input: CreateUserInput): Promise<UserRecord>;
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findByUsername(username: string): Promise<UserRecord | null>;
  update(id: string, patch: Partial<UserRecord>): Promise<UserRecord>;
  setEmailVerified(id: string, at: string): Promise<void>;
  markPendingDeletion(id: string): Promise<void>;
  updateLastLogin(id: string, at: string, ip: string | null): Promise<void>;
  getSettings(userId: string): Promise<UserSettingsRecord>;
  updateSettings(userId: string, patch: Partial<UserSettingsRecord>): Promise<UserSettingsRecord>;
}

export interface SessionRepository {
  create(input: SessionRecord): Promise<void>;
  findByRefreshHash(hash: string): Promise<SessionRecord | null>;
  findById(id: string): Promise<SessionRecord | null>;
  revoke(id: string, reason: string): Promise<void>;
  revokeAllForUser(userId: string, exceptId?: string): Promise<number>;
  listForUser(userId: string): Promise<SessionRecord[]>;
  touch(id: string, at: string): Promise<void>;
}

export interface DeviceRepository {
  upsert(input: {
    userId: string;
    deviceId: string;
    platform: string;
    model?: string;
    osVersion?: string;
    appVersion?: string;
  }): Promise<DeviceRecord>;
  findByDeviceId(deviceId: string): Promise<DeviceRecord | null>;
  findByDeviceAndUser(deviceId: string, userId: string): Promise<DeviceRecord | null>;
}

export interface VerificationTokenRepository {
  create(input: VerificationTokenRecord): Promise<void>;
  findByHash(hash: string): Promise<VerificationTokenRecord | null>;
  markUsed(id: string, at: string): Promise<void>;
  invalidateForUser(userId: string, kind: VerificationKind): Promise<number>;
}

export interface NotificationRepository {
  create(input: NotificationRecord): Promise<void>;
}

// ---------- Services ----------

export interface MailService {
  sendVerificationEmail(to: string, verificationUrl: string): Promise<void>;
  sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>;
  sendSecurityAlert(to: string, message: string): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export interface IssuedAccessToken {
  token: string;
  jti: string;
  expiresIn: number;
}

export interface AccessTokenClaims {
  sub: string;
  role: Role;
  jti: string;
  exp: number;
}

export interface TokenService {
  issueAccessToken(userId: string, role: Role): Promise<IssuedAccessToken>;
  verifyAccessToken(token: string): Promise<AccessTokenClaims | null>;
  /** Opaque refresh token + its SHA-256 hash for storage. */
  issueRefreshToken(): { token: string; hash: string };
  hashRefreshToken(token: string): string;
}

export interface RateLimiter {
  /**
   * Consume one unit for scope+identifier. Returns allowed=false with
   * retryAfterSeconds when the limit is exceeded.
   */
  consume(
    scope: string,
    identifier: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

// ---------- Auth result ----------

export interface AuthResult {
  user: {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    role: Role;
    createdAt: string;
  };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SessionView {
  id: string;
  deviceId: string;
  platform: string | null;
  lastUsedAt: string;
  isCurrent: boolean;
  createdAt: string;
}
