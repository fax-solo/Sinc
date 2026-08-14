import { ulid, UnauthorizedError } from '@sinc/shared';
import type {
  SessionRecord,
  SessionRepository,
  SessionView,
  UserRecord,
  UserRepository,
  NotificationRepository,
} from './types.js';

export interface SessionServiceOptions {
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  notificationRepository: NotificationRepository;
  refreshTtlDays: number;
  now?: () => Date;
}

/**
 * Session lifecycle: creation, rolling rotation, revocation, and
 * refresh-token reuse detection (a rotated-out token presented again is
 * treated as theft and revokes ALL user sessions).
 */
export class SessionService {
  private readonly userRepository: UserRepository;
  private readonly sessionRepository: SessionRepository;
  private readonly notificationRepository: NotificationRepository;
  private readonly refreshTtlMs: number;
  private readonly now: () => Date;

  constructor(options: SessionServiceOptions) {
    this.userRepository = options.userRepository;
    this.sessionRepository = options.sessionRepository;
    this.notificationRepository = options.notificationRepository;
    this.refreshTtlMs = options.refreshTtlDays * 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  private newSession(
    userId: string,
    refreshTokenHash: string,
    deviceId: string,
    ip: string | null,
    userAgent: string | null,
  ): SessionRecord {
    const now = this.now();
    return {
      id: ulid(),
      userId,
      refreshTokenHash,
      deviceId,
      expiresAt: new Date(now.getTime() + this.refreshTtlMs).toISOString(),
      revokedAt: null,
      revokedBy: null,
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      ipAddress: ip,
      userAgent,
    };
  }

  async createSession(
    userId: string,
    refreshTokenHash: string,
    deviceId: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<SessionRecord> {
    const session = this.newSession(userId, refreshTokenHash, deviceId, ip, userAgent);
    await this.sessionRepository.create(session);
    return session;
  }

  /**
   * Rotate a refresh token. The presented token must map to an active,
   * unexpired session; the old session is revoked and a new one created with
   * a rolling expiry.
   */
  async rotate(
    refreshTokenHash: string,
    deviceId: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<{ session: SessionRecord; user: UserRecord }> {
    const existing = await this.sessionRepository.findByRefreshHash(refreshTokenHash);
    if (!existing) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    if (existing.revokedAt) {
      // Reuse of a rotated-out token - likely theft. Revoke everything.
      await this.sessionRepository.revokeAllForUser(existing.userId);
      await this.notificationRepository.create({
        id: ulid(),
        userId: existing.userId,
        type: 'account.security',
        title: 'Security alert',
        body: 'We detected a possibly stolen refresh token and signed you out of all devices. Please log in again.',
        data: { event: 'refresh_token_reuse' },
        categoryId: 'security',
      });
      throw new UnauthorizedError('Refresh token has been revoked');
    }

    if (new Date(existing.expiresAt).getTime() <= this.now().getTime()) {
      await this.sessionRepository.revoke(existing.id, 'expired');
      throw new UnauthorizedError('Refresh token has expired');
    }

    const user = await this.userRepository.findById(existing.userId);
    if (!user) {
      throw new UnauthorizedError('Account no longer exists');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Account is not active');
    }

    await this.sessionRepository.revoke(existing.id, 'rotated');
    const session = this.newSession(existing.userId, refreshTokenHash, deviceId, ip, userAgent);
    await this.sessionRepository.create(session);
    return { session, user };
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session || session.userId !== userId) return;
    if (!session.revokedAt) {
      await this.sessionRepository.revoke(sessionId, 'user');
    }
  }

  /** Revoke the session that owns the given refresh-token hash (logout). */
  async revokeByRefreshHash(hash: string): Promise<boolean> {
    const session = await this.sessionRepository.findByRefreshHash(hash);
    if (!session || session.revokedAt) return false;
    await this.sessionRepository.revoke(session.id, 'logout');
    return true;
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.sessionRepository.revokeAllForUser(userId);
  }

  async listForUser(userId: string, currentSessionId?: string): Promise<SessionView[]> {
    const sessions = await this.sessionRepository.listForUser(userId);
    return sessions
      .filter((s) => !s.revokedAt)
      .map((s) => ({
        id: s.id,
        deviceId: s.deviceId,
        platform: null,
        lastUsedAt: s.lastUsedAt,
        isCurrent: s.id === currentSessionId,
        createdAt: s.createdAt,
      }));
  }
}
