import { PrismaClient } from '@prisma/client';

/**
 * Lazily-created Prisma client singleton. The client is only constructed
 * when repositories are first used, so tests that never touch persistence
 * do not require a database.
 */
let client: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
