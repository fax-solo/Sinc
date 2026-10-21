import { describe, expect, it } from 'vitest';
import { prisma } from './prisma.js';

describe('prisma client singleton', () => {
  it('exports a single shared client', async () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma.$connect).toBe('function');
    const { prisma: again } = await import('./prisma.js');
    expect(again).toBe(prisma);
  });

  it('can run a trivial round trip against the database', async () => {
    const rows = await prisma.$queryRaw`SELECT 1 AS ok`;
    expect(rows).toEqual([{ ok: 1 }]);
  });
});
