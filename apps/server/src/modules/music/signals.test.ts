import { describe, expect, it, vi } from 'vitest';
import { MusicSignalService } from './signals.js';

function makeDb() {
  const upsert = vi.fn();
  const count = vi.fn().mockResolvedValue(0);
  const findMany = vi.fn().mockResolvedValue([]);
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const createMany = vi.fn().mockResolvedValue({ count: 0 });

  const eventFindMany = vi.fn().mockResolvedValue([]);
  const eventCreateMany = vi.fn().mockResolvedValue({ count: 0 });
  const eventCount = vi.fn().mockResolvedValue(0);
  const eventDeleteMany = vi.fn().mockResolvedValue({ count: 0 });

  const snapshotFindUnique = vi.fn().mockResolvedValue(null);
  const snapshotUpsert = vi.fn().mockResolvedValue({});
  const snapshotDeleteMany = vi.fn().mockResolvedValue({ count: 0 });

  return {
    history: { upsert, count, findMany, deleteMany },
    favorite: { deleteMany, createMany, findMany },
    listeningEventLog: {
      findMany: eventFindMany,
      createMany: eventCreateMany,
      count: eventCount,
      deleteMany: eventDeleteMany,
    },
    userTasteSnapshot: {
      findUnique: snapshotFindUnique,
      upsert: snapshotUpsert,
      deleteMany: snapshotDeleteMany,
    },
    _fns: {
      upsert,
      count,
      findMany,
      deleteMany,
      createMany,
      eventFindMany,
      eventCreateMany,
      eventCount,
      eventDeleteMany,
      snapshotFindUnique,
      snapshotUpsert,
      snapshotDeleteMany,
    },
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

  describe('Phase 1: Listening Event Logging & Idempotency', () => {
    it('ingests valid listening events and discards duplicates', async () => {
      const db = makeDb();
      // Simulate that idempotencyId "dup_1" already exists
      db._fns.eventFindMany.mockResolvedValueOnce([{ idempotencyId: 'dup_1' }]);

      const service = new MusicSignalService(db as never);
      const events: any[] = [
        {
          id: '1',
          sessionId: 's1',
          trackId: 't1',
          trackTitle: 'Song 1',
          artistName: 'Artist 1',
          eventType: 'track_started',
          idempotencyId: 'dup_1',
          timestamp: Date.now(),
        },
        {
          id: '2',
          sessionId: 's1',
          trackId: 't2',
          trackTitle: 'Song 2',
          artistName: 'Artist 2',
          eventType: 'track_completed',
          idempotencyId: 'new_2',
          timestamp: Date.now(),
        },
      ];

      const res = await service.recordListeningEvents('u1', events);
      expect(res.processed).toBe(1);
      expect(res.duplicates).toBe(1);

      expect(db._fns.eventCreateMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            userId: 'u1',
            sessionId: 's1',
            trackId: 't2',
            idempotencyId: 'new_2',
          }),
        ],
      });
      expect(db._fns.snapshotDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    });

    it('returns paginated listening events with user isolation', async () => {
      const db = makeDb();
      db._fns.eventFindMany.mockResolvedValueOnce([{ id: 'row1' }]);
      db._fns.eventCount.mockResolvedValueOnce(1);

      const service = new MusicSignalService(db as never);
      const res = await service.getListeningEvents('u1', { page: 1, limit: 10, eventType: 'track_completed' });

      expect(res.total).toBe(1);
      expect(res.data).toHaveLength(1);
      expect(db._fns.eventFindMany).toHaveBeenCalledWith({
        where: { userId: 'u1', eventType: 'track_completed' },
        skip: 0,
        take: 10,
        orderBy: { timestamp: 'desc' },
      });
    });

    it('deletes all listening history, legacy history, and taste snapshot for GDPR compliance', async () => {
      const db = makeDb();
      db._fns.eventDeleteMany.mockResolvedValueOnce({ count: 5 });

      const service = new MusicSignalService(db as never);
      const res = await service.deleteListeningHistory('u1');

      expect(res.deleted).toBe(5);
      expect(db._fns.eventDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(db._fns.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(db._fns.snapshotDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    });

    it('returns cold-start profile when user has zero history', async () => {
      const db = makeDb();
      db._fns.snapshotFindUnique.mockResolvedValueOnce(null);
      db._fns.eventFindMany.mockResolvedValueOnce([]);
      db.favorite.findMany.mockResolvedValueOnce([]);

      const service = new MusicSignalService(db as never);
      const profile = await service.getUserTasteProfile('u_cold');

      expect(profile.isEmpty).toBe(true);
      expect(profile.topArtists).toHaveLength(0);
      expect(profile.topGenres).toHaveLength(0);
      expect(profile.totalListeningTimeMs).toBe(0);
    });

    it('returns cached snapshot if already present and valid', async () => {
      const db = makeDb();
      const mockCached = {
        topArtists: [{ name: 'Cached Artist', score: 10, playCount: 5, completionCount: 3, skipCount: 0 }],
        topGenres: [],
        topAlbums: [],
        favoriteGenres: [],
        favoriteArtists: [],
        frequentlyPlayedTracks: [],
        recentlyPlayedTracks: [],
        repeatedlyPlayedTracks: [],
        skippedTracks: [],
        discoveryMode: 'balanced',
        discoveryPreference: 0.5,
        personalizationEnabled: true,
        totalListeningTimeMs: 100000,
        totalQualifiedPlays: 5,
        totalCompletions: 3,
        totalSkips: 0,
        isEmpty: false,
        lastUpdated: Date.now(),
      };
      db._fns.snapshotFindUnique.mockResolvedValueOnce({ profile: mockCached });

      const service = new MusicSignalService(db as never);
      const profile = await service.getUserTasteProfile('u_cached');

      expect(profile.isEmpty).toBe(false);
      expect(profile.topArtists[0].name).toBe('Cached Artist');
      expect(db._fns.eventFindMany).not.toHaveBeenCalled();
    });
  });
});
