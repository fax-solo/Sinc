import type { PrismaClient, Prisma } from '@prisma/client';
import { ulid } from '@sinc/shared';
import type {
  CreateUserInput,
  UserRecord,
  UserRepository,
  UserSettingsRecord,
} from '../domain/auth/types.js';

function toRecord(row: {
  id: string;
  email: string;
  emailVerified: boolean;
  emailVerifiedAt: Date | null;
  passwordHash: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  avatarObjectKey: string | null;
  role: string;
  status: string;
  statusReason: string | null;
  locale: string;
  themePreference: string;
  lastLoginAt: Date | null;
  lastLoginIp: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}): UserRecord {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
    passwordHash: row.passwordHash,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    avatarObjectKey: row.avatarObjectKey,
    role: row.role as UserRecord['role'],
    status: row.status as UserRecord['status'],
    statusReason: row.statusReason,
    locale: row.locale,
    themePreference: row.themePreference,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    lastLoginIp: row.lastLoginIp,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

function toSettings(row: {
  playback: unknown;
  downloads: unknown;
  lyrics: unknown;
  appearance: unknown;
  privacy: unknown;
  security: unknown;
  dataSaver: unknown;
}): UserSettingsRecord {
  return {
    playback: (row.playback as Record<string, unknown> | null) ?? {},
    downloads: (row.downloads as Record<string, unknown> | null) ?? {},
    lyrics: (row.lyrics as Record<string, unknown> | null) ?? {},
    appearance: (row.appearance as Record<string, unknown> | null) ?? {},
    privacy: (row.privacy as Record<string, unknown> | null) ?? {},
    security: (row.security as Record<string, unknown> | null) ?? {},
    dataSaver: (row.dataSaver as Record<string, unknown> | null) ?? {},
  };
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateUserInput): Promise<UserRecord> {
    const row = await this.db.user.create({
      data: {
        id: input.id,
        email: input.email,
        passwordHash: input.passwordHash,
        username: input.username,
        displayName: input.displayName,
        locale: input.locale,
        role: input.role ?? 'USER',
      },
    });
    return toRecord(row);
  }

  async findById(id: string): Promise<UserRecord | null> {
    const row = await this.db.user.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.db.user.findUnique({ where: { email } });
    return row ? toRecord(row) : null;
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const row = await this.db.user.findUnique({ where: { username } });
    return row ? toRecord(row) : null;
  }

  async update(id: string, patch: Partial<UserRecord>): Promise<UserRecord> {
    const row = await this.db.user.update({
      where: { id },
      data: {
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.emailVerified !== undefined ? { emailVerified: patch.emailVerified } : {}),
        ...(patch.emailVerifiedAt !== undefined
          ? { emailVerifiedAt: patch.emailVerifiedAt ? new Date(patch.emailVerifiedAt) : null }
          : {}),
        ...(patch.passwordHash !== undefined ? { passwordHash: patch.passwordHash } : {}),
        ...(patch.username !== undefined ? { username: patch.username } : {}),
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
        ...(patch.avatarObjectKey !== undefined ? { avatarObjectKey: patch.avatarObjectKey } : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.statusReason !== undefined ? { statusReason: patch.statusReason } : {}),
        ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
        ...(patch.themePreference !== undefined ? { themePreference: patch.themePreference } : {}),
        ...(patch.lastLoginAt !== undefined
          ? { lastLoginAt: patch.lastLoginAt ? new Date(patch.lastLoginAt) : null }
          : {}),
        ...(patch.lastLoginIp !== undefined ? { lastLoginIp: patch.lastLoginIp } : {}),
        ...(patch.deletedAt !== undefined
          ? { deletedAt: patch.deletedAt ? new Date(patch.deletedAt) : null }
          : {}),
      },
    });
    return toRecord(row);
  }

  async setEmailVerified(id: string, at: string): Promise<void> {
    await this.db.user.update({
      where: { id },
      data: { emailVerified: true, emailVerifiedAt: new Date(at) },
    });
  }

  async markPendingDeletion(id: string): Promise<void> {
    await this.db.user.update({
      where: { id },
      data: { status: 'PENDING_DELETION', deletedAt: new Date() },
    });
  }

  async updateLastLogin(id: string, at: string, ip: string | null): Promise<void> {
    await this.db.user.update({
      where: { id },
      data: { lastLoginAt: new Date(at), lastLoginIp: ip },
    });
  }

  async getSettings(userId: string): Promise<UserSettingsRecord> {
    const row = await this.db.userSettings.findUnique({ where: { userId } });
    if (!row)
      return {
        playback: {},
        downloads: {},
        lyrics: {},
        appearance: {},
        privacy: {},
        security: {},
        dataSaver: {},
      };
    return toSettings(row);
  }

  async updateSettings(
    userId: string,
    patch: Partial<UserSettingsRecord>,
  ): Promise<UserSettingsRecord> {
    const json = (value: Record<string, unknown> | undefined): Prisma.InputJsonValue =>
      (value ?? {}) as Prisma.InputJsonValue;
    const row = await this.db.userSettings.upsert({
      where: { userId },
      create: {
        id: ulid(),
        userId,
        playback: json(patch.playback),
        downloads: json(patch.downloads),
        lyrics: json(patch.lyrics),
        appearance: json(patch.appearance),
        privacy: json(patch.privacy),
        security: json(patch.security),
        dataSaver: json(patch.dataSaver),
      },
      update: {
        ...(patch.playback !== undefined
          ? { playback: patch.playback as Prisma.InputJsonValue }
          : {}),
        ...(patch.downloads !== undefined
          ? { downloads: patch.downloads as Prisma.InputJsonValue }
          : {}),
        ...(patch.lyrics !== undefined ? { lyrics: patch.lyrics as Prisma.InputJsonValue } : {}),
        ...(patch.appearance !== undefined
          ? { appearance: patch.appearance as Prisma.InputJsonValue }
          : {}),
        ...(patch.privacy !== undefined ? { privacy: patch.privacy as Prisma.InputJsonValue } : {}),
        ...(patch.security !== undefined
          ? { security: patch.security as Prisma.InputJsonValue }
          : {}),
        ...(patch.dataSaver !== undefined
          ? { dataSaver: patch.dataSaver as Prisma.InputJsonValue }
          : {}),
      },
    });
    return toSettings(row);
  }
}
