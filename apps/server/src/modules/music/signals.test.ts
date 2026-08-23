import { describe, expect, it, vi } from 'vitest';
import { MusicSignalService } from './signals.js';

function makeDb() {
  const upsert = vi.fn();
  const count = vi.fn().mockResolvedValue(0);
  const findMany = vi.fn().mockResolvedValue([]);
  const deleteMany = vi.fn();
  const createMany = vi.fn();
  return {
    history: { upsert, count, findMany, deleteMany },
    favorite: { deleteMany, createMany },
    // expose for assertions
    _fns: { upsert, count, findMany, deleteMany, createMany },
  };
}

describe('MusicSignalService', () => {
  it('creates a new history row when none exists', async () => {
    const db = makeDb();
    const service = new MusicSignalService(db as never);
    await service.recordPlay('u1', {
      trackId: 'itunes:1',
      trackTitle: 'Song',
      trackArtist: 'Artist',
      durationMs: 1000,
    });
    expect(db._fns.upsert).toHaveBeenCalledWith({
      where: { userId_trackId: { userId: 'u1', trackId: 'itunes:1' } },
      create: expect.objectContaining({
        userId: 'u1',
        trackId: 'itunes:1',
        trackTitle: 'Song',
        trackArtist: 'Artist',
        durationMs: 1000,
      }),
      update: expect.objectContaining({
        trackTitle: 'Song',
        trackArtist: 'Artist',
        durationMs: 1000,
      }),
    });
  });

  it('updates an existing row instead of duplicating', async () => {
    const db = makeDb();
    const service = new MusicSignalService(db as never);
    await service.recordPlay('u1', {
      trackId: 'itunes:1',
      trackTitle: 'Song',
      trackArtist: 'Artist',
    });
    expect(db._fns.upsert).toHaveBeenCalledWith({
      where: { userId_trackId: { userId: 'u1', trackId: 'itunes:1' } },
      create: expect.objectContaining({ userId: 'u1', trackId: 'itunes:1' }),
      update: expect.objectContaining({ trackTitle: 'Song', trackArtist: 'Artist' }),
    });
  });

  it('caps history to HISTORY_CAP rows', async () => {
    const db = makeDb();
    db.history.count.mockResolvedValue(501);
    db.history.findMany.mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }]);
    const service = new MusicSignalService(db as never);
    await service.recordPlay('u1', { trackId: 'itunes:1' });
    expect(db._fns.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 500, orderBy: { playedAt: 'desc' } })
    );
    expect(db._fns.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['old-1', 'old-2'] } },
    });
  });

  it('ignores plays without a trackId', async () => {
    const db = makeDb();
    const service = new MusicSignalService(db as never);
    await service.recordPlay('u1', { trackId: '' });
    expect(db._fns.upsert).not.toHaveBeenCalled();
  });

  it('replaces favorites idempotently', async () => {
    const db = makeDb();
    const service = new MusicSignalService(db as never);
    await service.syncFavorites('u1', [
      { trackId: 'itunes:1', trackTitle: 'Song', trackSubtitle: 'Artist' },
      { trackId: 'itunes:2' },
      { trackId: '' },
    ]);
    expect(db._fns.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', targetType: 'track' },
    });
    expect(db._fns.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          userId: 'u1',
          targetId: 'itunes:1',
          targetTitle: 'Song',
          targetSubtitle: 'Artist',
        }),
        expect.objectContaining({ userId: 'u1', targetId: 'itunes:2' }),
      ]),
    });
    const data = (db._fns.createMany.mock.calls[0][0] as { data: unknown[] }).data;
    expect(data).toHaveLength(2);
  });

  it('clears favorites when the list is empty', async () => {
    const db = makeDb();
    const service = new MusicSignalService(db as never);
    await service.syncFavorites('u1', []);
    expect(db._fns.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', targetType: 'track' },
    });
    expect(db._fns.createMany).not.toHaveBeenCalled();
  });
});
