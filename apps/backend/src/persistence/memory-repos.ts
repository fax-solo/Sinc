import type {
  CreateUserInput,
  DeviceRecord,
  DeviceRepository,
  NotificationRecord,
  NotificationRepository,
  SessionRecord,
  SessionRepository,
  UserRecord,
  UserRepository,
  UserSettingsRecord,
  VerificationTokenRecord,
  VerificationTokenRepository,
} from '../domain/auth/types.js';

export const DEFAULT_SETTINGS: UserSettingsRecord = {
  playback: {},
  downloads: {},
  lyrics: {},
  appearance: {},
  privacy: {},
  security: {},
  dataSaver: {},
};

export class MemoryUserRepository implements UserRepository {
  users = new Map<string, UserRecord>();
  settings = new Map<string, UserSettingsRecord>();

  async create(input: CreateUserInput): Promise<UserRecord> {
    const now = new Date().toISOString();
    const user: UserRecord = {
      id: input.id,
      email: input.email,
      emailVerified: false,
      emailVerifiedAt: null,
      passwordHash: input.passwordHash,
      username: input.username,
      displayName: input.displayName,
      avatarUrl: null,
      avatarObjectKey: null,
      role: input.role ?? 'USER',
      status: 'ACTIVE',
      statusReason: null,
      locale: input.locale,
      themePreference: 'system',
      lastLoginAt: null,
      lastLoginIp: null,
      createdAt: now,
      deletedAt: null,
    };
    this.users.set(user.id, user);
    this.settings.set(user.id, { ...DEFAULT_SETTINGS });
    return user;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    for (const user of this.users.values()) {
      if (user.username === username) return user;
    }
    return null;
  }

  async update(id: string, patch: Partial<UserRecord>): Promise<UserRecord> {
    const user = this.users.get(id);
    if (!user) throw new Error(`User not found: ${id}`);
    const updated = { ...user, ...patch };
    this.users.set(id, updated);
    return updated;
  }

  async setEmailVerified(id: string, at: string): Promise<void> {
    await this.update(id, { emailVerified: true, emailVerifiedAt: at });
  }

  async markPendingDeletion(id: string): Promise<void> {
    await this.update(id, {
      status: 'PENDING_DELETION',
      deletedAt: new Date().toISOString(),
    });
  }

  async updateLastLogin(id: string, at: string, ip: string | null): Promise<void> {
    await this.update(id, { lastLoginAt: at, lastLoginIp: ip });
  }

  async getSettings(userId: string): Promise<UserSettingsRecord> {
    return this.settings.get(userId) ?? { ...DEFAULT_SETTINGS };
  }

  async updateSettings(
    userId: string,
    patch: Partial<UserSettingsRecord>,
  ): Promise<UserSettingsRecord> {
    const current = await this.getSettings(userId);
    const merged = {
      playback: { ...current.playback, ...(patch.playback ?? {}) },
      downloads: { ...current.downloads, ...(patch.downloads ?? {}) },
      lyrics: { ...current.lyrics, ...(patch.lyrics ?? {}) },
      appearance: { ...current.appearance, ...(patch.appearance ?? {}) },
      privacy: { ...current.privacy, ...(patch.privacy ?? {}) },
      security: { ...current.security, ...(patch.security ?? {}) },
      dataSaver: { ...current.dataSaver, ...(patch.dataSaver ?? {}) },
    };
    this.settings.set(userId, merged);
    return merged;
  }
}

export class MemorySessionRepository implements SessionRepository {
  sessions = new Map<string, SessionRecord>();

  async create(input: SessionRecord): Promise<void> {
    this.sessions.set(input.id, { ...input });
  }

  async findByRefreshHash(hash: string): Promise<SessionRecord | null> {
    for (const session of this.sessions.values()) {
      if (session.refreshTokenHash === hash) return session;
    }
    return null;
  }

  async findById(id: string): Promise<SessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }

  async revoke(id: string, reason: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.set(id, {
      ...session,
      revokedAt: new Date().toISOString(),
      revokedBy: reason,
    });
  }

  async revokeAllForUser(userId: string, exceptId?: string): Promise<number> {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.id !== exceptId && !session.revokedAt) {
        await this.revoke(session.id, 'revoked_all');
        count++;
      }
    }
    return count;
  }

  async listForUser(userId: string): Promise<SessionRecord[]> {
    return [...this.sessions.values()].filter((s) => s.userId === userId);
  }

  async touch(id: string, at: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session) this.sessions.set(id, { ...session, lastUsedAt: at });
  }
}

export class MemoryDeviceRepository implements DeviceRepository {
  devices = new Map<string, DeviceRecord>();

  async upsert(input: {
    userId: string;
    deviceId: string;
    platform: string;
    model?: string;
    osVersion?: string;
    appVersion?: string;
  }): Promise<DeviceRecord> {
    const existing = this.devices.get(input.deviceId);
    const now = new Date().toISOString();
    if (existing) {
      const updated: DeviceRecord = {
        ...existing,
        userId: input.userId,
        platform: input.platform,
        model: input.model ?? existing.model,
        lastSeenAt: now,
      };
      this.devices.set(input.deviceId, updated);
      return updated;
    }
    const record: DeviceRecord = {
      id: input.deviceId,
      userId: input.userId,
      platform: input.platform,
      model: input.model ?? null,
      osVersion: input.osVersion ?? null,
      appVersion: input.appVersion ?? null,
      lastSeenAt: now,
      createdAt: now,
    };
    this.devices.set(input.deviceId, record);
    return record;
  }

  async findByDeviceId(deviceId: string): Promise<DeviceRecord | null> {
    return this.devices.get(deviceId) ?? null;
  }

  async findByDeviceAndUser(deviceId: string, userId: string): Promise<DeviceRecord | null> {
    const device = this.devices.get(deviceId);
    return device && device.userId === userId ? device : null;
  }
}

export class MemoryVerificationTokenRepository implements VerificationTokenRepository {
  tokens = new Map<string, VerificationTokenRecord>();

  async create(input: VerificationTokenRecord): Promise<void> {
    this.tokens.set(input.id, { ...input });
  }

  async findByHash(hash: string): Promise<VerificationTokenRecord | null> {
    for (const token of this.tokens.values()) {
      if (token.tokenHash === hash) return token;
    }
    return null;
  }

  async markUsed(id: string, at: string): Promise<void> {
    const token = this.tokens.get(id);
    if (token) this.tokens.set(id, { ...token, usedAt: at });
  }

  async invalidateForUser(userId: string, kind: string): Promise<number> {
    let count = 0;
    for (const token of this.tokens.values()) {
      if (token.userId === userId && token.kind === kind && !token.usedAt) {
        this.tokens.set(token.id, { ...token, usedAt: new Date().toISOString() });
        count++;
      }
    }
    return count;
  }
}

export class MemoryNotificationRepository implements NotificationRepository {
  notifications: NotificationRecord[] = [];

  async create(input: NotificationRecord): Promise<void> {
    this.notifications.push(input);
  }
}

export class MemoryMailService {
  sent: Array<{ kind: string; to: string; url?: string; message?: string }> = [];

  async sendVerificationEmail(to: string, verificationUrl: string): Promise<void> {
    this.sent.push({ kind: 'verify', to, url: verificationUrl });
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    this.sent.push({ kind: 'reset', to, url: resetUrl });
  }

  async sendSecurityAlert(to: string, message: string): Promise<void> {
    this.sent.push({ kind: 'security', to, message });
  }

  lastUrl(kind: string): string {
    const mail = this.sent.find((m) => m.kind === kind);
    if (!mail?.url) throw new Error(`No ${kind} mail sent`);
    return mail.url;
  }
}
