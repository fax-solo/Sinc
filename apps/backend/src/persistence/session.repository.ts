import type { PrismaClient } from '@prisma/client';
import type { SessionRecord, SessionRepository } from '../domain/auth/types.js';

function toRecord(row: {
  id: string;
  userId: string;
  refreshTokenHash: string;
  deviceId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    refreshTokenHash: row.refreshTokenHash,
    deviceId: row.deviceId,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedBy: row.revokedBy,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt.toISOString(),
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: SessionRecord): Promise<void> {
    await this.db.session.create({
      data: {
        id: input.id,
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        deviceId: input.deviceId,
        expiresAt: new Date(input.expiresAt),
        revokedAt: input.revokedAt ? new Date(input.revokedAt) : null,
        revokedBy: input.revokedBy,
        lastUsedAt: new Date(input.lastUsedAt),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  async findByRefreshHash(hash: string): Promise<SessionRecord | null> {
    const row = await this.db.session.findUnique({ where: { refreshTokenHash: hash } });
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<SessionRecord | null> {
    const row = await this.db.session.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async revoke(id: string, reason: string): Promise<void> {
    await this.db.session.update({
      where: { id },
      data: { revokedAt: new Date(), revokedBy: reason },
    });
  }

  async revokeAllForUser(userId: string, exceptId?: string): Promise<number> {
    const result = await this.db.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { revokedAt: new Date(), revokedBy: 'revoked_all' },
    });
    return result.count;
  }

  async listForUser(userId: string): Promise<SessionRecord[]> {
    const rows = await this.db.session.findMany({
      where: { userId },
      orderBy: { lastUsedAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  async touch(id: string, at: string): Promise<void> {
    await this.db.session.update({
      where: { id },
      data: { lastUsedAt: new Date(at) },
    });
  }
}
