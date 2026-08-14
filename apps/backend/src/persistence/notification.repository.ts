import type { PrismaClient, Prisma } from '@prisma/client';
import type { NotificationRecord, NotificationRepository } from '../domain/auth/types.js';

export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: NotificationRecord): Promise<void> {
    await this.db.notification.create({
      data: {
        id: input.id,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
        categoryId: input.categoryId,
      },
    });
  }
}
