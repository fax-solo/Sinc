import type { PrismaClient } from '@prisma/client';
import type { DeviceRecord, DeviceRepository } from '../domain/auth/types.js';

export class PrismaDeviceRepository implements DeviceRepository {
  constructor(private readonly db: PrismaClient) {}

  async upsert(input: {
    userId: string;
    deviceId: string;
    platform: string;
    model?: string;
    osVersion?: string;
    appVersion?: string;
  }): Promise<DeviceRecord> {
    const row = await this.db.device.upsert({
      where: { id: input.deviceId },
      create: {
        id: input.deviceId,
        userId: input.userId,
        platform: input.platform,
        model: input.model ?? null,
        osVersion: input.osVersion ?? null,
        appVersion: input.appVersion ?? null,
      },
      update: {
        userId: input.userId,
        platform: input.platform,
        model: input.model ?? null,
        osVersion: input.osVersion ?? null,
        appVersion: input.appVersion ?? null,
        lastSeenAt: new Date(),
      },
    });
    return {
      id: row.id,
      userId: row.userId,
      platform: row.platform,
      model: row.model,
      osVersion: row.osVersion,
      appVersion: row.appVersion,
      lastSeenAt: row.lastSeenAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async findByDeviceId(deviceId: string): Promise<DeviceRecord | null> {
    const row = await this.db.device.findUnique({ where: { id: deviceId } });
    return row
      ? {
          id: row.id,
          userId: row.userId,
          platform: row.platform,
          model: row.model,
          osVersion: row.osVersion,
          appVersion: row.appVersion,
          lastSeenAt: row.lastSeenAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
        }
      : null;
  }

  async findByDeviceAndUser(deviceId: string, userId: string): Promise<DeviceRecord | null> {
    const row = await this.db.device.findFirst({ where: { id: deviceId, userId } });
    return row
      ? {
          id: row.id,
          userId: row.userId,
          platform: row.platform,
          model: row.model,
          osVersion: row.osVersion,
          appVersion: row.appVersion,
          lastSeenAt: row.lastSeenAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
        }
      : null;
  }
}
