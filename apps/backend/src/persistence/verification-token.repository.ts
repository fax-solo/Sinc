import type { PrismaClient } from '@prisma/client';
import type {
  VerificationKind,
  VerificationTokenRecord,
  VerificationTokenRepository,
} from '../domain/auth/types.js';

export class PrismaVerificationTokenRepository implements VerificationTokenRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: VerificationTokenRecord): Promise<void> {
    await this.db.verificationToken.create({
      data: {
        id: input.id,
        userId: input.userId,
        kind: input.kind,
        tokenHash: input.tokenHash,
        expiresAt: new Date(input.expiresAt),
        usedAt: input.usedAt ? new Date(input.usedAt) : null,
      },
    });
  }

  async findByHash(hash: string): Promise<VerificationTokenRecord | null> {
    const row = await this.db.verificationToken.findUnique({
      where: { tokenHash: hash },
    });
    return row
      ? {
          id: row.id,
          userId: row.userId,
          kind: row.kind as VerificationKind,
          tokenHash: row.tokenHash,
          expiresAt: row.expiresAt.toISOString(),
          usedAt: row.usedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        }
      : null;
  }

  async markUsed(id: string, at: string): Promise<void> {
    await this.db.verificationToken.update({
      where: { id },
      data: { usedAt: new Date(at) },
    });
  }

  async invalidateForUser(userId: string, kind: VerificationKind): Promise<number> {
    const result = await this.db.verificationToken.updateMany({
      where: { userId, kind, usedAt: null },
      data: { usedAt: new Date() },
    });
    return result.count;
  }
}
