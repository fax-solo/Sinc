import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runRetentionSweep, startRetentionSweeper } from './retention.js';

interface DbLike {
  session: { deleteMany: ReturnType<typeof vi.fn> };
  verificationToken: { deleteMany: ReturnType<typeof vi.fn> };
  searchCache: { deleteMany: ReturnType<typeof vi.fn> };
  analyticsEvent: { deleteMany: ReturnType<typeof vi.fn> };
  auditLog: { deleteMany: ReturnType<typeof vi.fn> };
}

function makeDb(): DbLike {
  return {
    session: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    verificationToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    searchCache: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    analyticsEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
}

describe('runRetentionSweep', () => {
  it('trims every limited-growth table', async () => {
    const db = makeDb();
    await runRetentionSweep(db as never);
    expect(db.session.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.verificationToken.deleteMany).toHaveBeenCalled();
    expect(db.searchCache.deleteMany).toHaveBeenCalled();
    expect(db.analyticsEvent.deleteMany).toHaveBeenCalled();
    expect(db.auditLog.deleteMany).toHaveBeenCalled();
  });

  it('only prunes expired sessions and revocations past the grace window', async () => {
    const db = makeDb();
    const before = Date.now();
    await runRetentionSweep(db as never);
    const arg = (db.session.deleteMany.mock.calls[0][0] as { where: { OR: unknown[] } }).where.OR;
    expect(arg).toHaveLength(2);
    const [{ expiresAt }, { revokedAt }] = arg as [
      { expiresAt: { lt: Date } },
      { revokedAt: { lt: Date } },
    ];
    const graceMs = 7 * 24 * 60 * 60 * 1000;
    expect(expiresAt.lt.getTime()).toBeGreaterThanOrEqual(before);
    // Revocation grace window is 7 days (allowing for clock skew of a ms).
    expect(revokedAt.lt.getTime()).toBeLessThanOrEqual(before - graceMs);
    expect(revokedAt.lt.getTime()).toBeGreaterThan(before - graceMs - 1000);
  });

  it('survives a failing deleteMany', async () => {
    const db = makeDb();
    db.session.deleteMany.mockRejectedValue(new Error('db down'));
    await expect(runRetentionSweep(db as never)).rejects.toThrow('db down');
  });
});

describe('startRetentionSweeper', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs an initial sweep, then on the interval, until disposed', async () => {
    const db = makeDb();
    const stop = startRetentionSweeper(db as never);
    expect(db.session.deleteMany).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(db.session.deleteMany).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6 * 60 * 60 * 1000);
    expect(db.session.deleteMany).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(12 * 60 * 60 * 1000);
    expect(db.session.deleteMany).toHaveBeenCalledTimes(2);
  });
});
