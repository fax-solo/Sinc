import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { syncUserPlaylists } from './routes.js';
import type { LibraryPayload } from './personalization.js';

let userId = '';
const userEmail = `sync-${randomUUID().slice(0, 8)}@sinc.dev`;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: userEmail, username: `sync_${randomUUID().slice(0, 8)}`, passwordHash: 'x' },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: userEmail } });
  await prisma.$disconnect();
});

function library(playlists: NonNullable<LibraryPayload['playlists']>): LibraryPayload {
  return { playlists };
}

describe('syncUserPlaylists', () => {
  it('creates playlists from the library snapshot', async () => {
    await syncUserPlaylists(
      userId,
      library([
        {
          id: 'p1',
          name: 'Chill',
          artworkUrl: 'https://example.com/a.jpg',
          trackCount: 12,
          updatedAt: Date.UTC(2026, 0, 1),
        },
        { id: 'p2', name: 'Gym', trackCount: 30, updatedAt: 0 },
      ])
    );

    const rows = await prisma.playlist.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    const p1 = rows[0];
    expect(p1.id).toBe(`${userId}::p1`);
    expect(p1.name).toBe('Chill');
    expect(p1.artworkUrl).toBe('https://example.com/a.jpg');
    expect(p1.trackCount).toBe(12);
  });

  it('updates changed playlists and prunes removed ones', async () => {
    await syncUserPlaylists(
      userId,
      library([
        { id: 'p1', name: 'Chill Mix', trackCount: 14, updatedAt: Date.UTC(2026, 1, 1) },
        { id: 'p3', name: 'New', trackCount: 5, updatedAt: Date.UTC(2026, 1, 2) },
      ])
    );

    const rows = await prisma.playlist.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual([`${userId}::p1`, `${userId}::p3`]);
    const p1 = rows.find((r) => r.id === `${userId}::p1`)!;
    expect(p1.name).toBe('Chill Mix');
    expect(p1.trackCount).toBe(14);
  });

  it('deletes every playlist when the library is empty', async () => {
    await syncUserPlaylists(
      userId,
      library([{ id: 'p1', name: 'Temp', trackCount: 1, updatedAt: Date.UTC(2026, 2, 1) }])
    );
    await syncUserPlaylists(userId, library([]));

    const rows = await prisma.playlist.findMany({ where: { userId } });
    expect(rows).toHaveLength(0);
  });

  it('namespaces playlists per user', async () => {
    const other = await prisma.user.create({
      data: {
        email: `sync-other-${randomUUID().slice(0, 8)}@sinc.dev`,
        username: `sync_o_${randomUUID().slice(0, 8)}`,
        passwordHash: 'x',
      },
    });
    try {
      await syncUserPlaylists(
        userId,
        library([{ id: 'dup', name: 'A', trackCount: 1, updatedAt: 0 }])
      );
      await syncUserPlaylists(
        other.id,
        library([{ id: 'dup', name: 'B', trackCount: 2, updatedAt: 0 }])
      );
      await syncUserPlaylists(userId, library([]));

      const others = await prisma.playlist.findMany({ where: { userId: other.id } });
      expect(others).toHaveLength(1);
      expect(others[0].name).toBe('B');
    } finally {
      await prisma.user.deleteMany({ where: { id: other.id } });
    }
  });
});
