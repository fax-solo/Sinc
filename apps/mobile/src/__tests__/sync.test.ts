import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { librarySchema } from '../db/schema';
import { createDatabase } from '../db/database';
import {
  addToPlaylist,
  createPlaylist,
  favoritesQuery,
  playlistsQuery,
  removePlaylist,
  renamePlaylist,
  saveTrack,
  toggleFavorite,
} from '../db/repositories';
import { pendingSyncOpsQuery } from '../db/syncOps';
import { runSync } from '../db/syncService';
import { applySyncMutations, getSyncSnapshot } from '../api/sync';
import type { SyncSnapshot } from '@sinc/shared';

vi.mock('@nozbe/watermelondb/adapters/sqlite', () => ({ default: class SQLiteAdapterMock {} }));
vi.mock('../api/sync', () => ({
  getSyncSnapshot: vi.fn(),
  applySyncMutations: vi.fn(),
}));

const mockApply = vi.mocked(applySyncMutations);
const mockSnapshot = vi.mocked(getSyncSnapshot);

function makeDb(name: string): Database {
  return createDatabase(
    new LokiJSAdapter({
      dbName: name,
      schema: librarySchema,
      useWebWorker: false,
      useIncrementalIndexedDB: true,
    }),
  );
}

function emptySnapshot(): SyncSnapshot {
  return { playlists: [], favorites: [], serverTime: Date.now() };
}

function serverPlaylist(overrides: Partial<SyncSnapshot['playlists'][number]> = {}) {
  return {
    id: 'p1',
    name: 'Server Mix',
    description: null,
    artworkUrl: null,
    isCollaborative: false,
    version: 1,
    trackIds: [],
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

describe('sync queue', () => {
  let db: Database;

  beforeEach(() => {
    db = makeDb(`sync-${Math.random().toString(36).slice(2)}`);
    mockApply.mockReset();
    mockSnapshot.mockReset();
  });

  it('queues ops on every playlist and favorite mutation', async () => {
    const playlist = await createPlaylist(db, { name: 'Mix' });
    await renamePlaylist(db, playlist.id, 'Mix 2');
    await toggleFavorite(db, 'track', 't1', { title: 'Song' });
    await removePlaylist(db, playlist.id);

    const ops = await pendingSyncOpsQuery(db).fetch();
    expect(ops).toHaveLength(4);
    const payloads = ops.map((op) => JSON.parse(op.payload) as { kind: string });
    expect(payloads.map((p) => p.kind)).toEqual([
      'playlistUpsert',
      'playlistUpsert',
      'favoriteToggle',
      'playlistDelete',
    ]);
  });

  it('pushes the queue, clears it and reconciles the snapshot', async () => {
    await createPlaylist(db, { name: 'Mix' });
    const ops = await pendingSyncOpsQuery(db).fetch();
    expect(ops).toHaveLength(1);

    mockApply.mockResolvedValueOnce({
      applied: [ops[0]!.id],
      conflicts: [],
      snapshot: { ...emptySnapshot(), playlists: [serverPlaylist({ name: 'Mix', version: 1 })] },
    });

    const result = await runSync(db);
    expect(result.pushed).toBe(1);
    expect(result.applied).toEqual([ops[0]!.id]);
    expect(result.conflicts).toEqual([]);
    expect(await pendingSyncOpsQuery(db).fetch()).toHaveLength(0);
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  it('pulls a snapshot when there are no pending ops', async () => {
    mockSnapshot.mockResolvedValueOnce({
      ...emptySnapshot(),
      playlists: [serverPlaylist({ trackIds: ['t1', 't2'] })],
      favorites: [{ id: 'f1', targetType: 'track', targetId: 't9', addedAt: 1000 }],
    });

    const result = await runSync(db);
    expect(mockApply).not.toHaveBeenCalled();
    expect(result.pulledPlaylists).toBe(1);
    expect(result.pulledFavorites).toBe(1);

    const lists = await playlistsQuery(db).fetch();
    expect(lists).toHaveLength(1);
    expect(lists[0]?.name).toBe('Server Mix');
    expect(lists[0]?.version).toBe(1);
    expect(lists[0]?.id).toBe('p1');
    const favs = await favoritesQuery(db).fetch();
    expect(favs.map((f) => f.targetId)).toEqual(['t9']);
  });

  it('server wins on version conflicts and drops the local mutations', async () => {
    const playlist = await createPlaylist(db, { name: 'Local' });
    await renamePlaylist(db, playlist.id, 'Local Renamed');
    expect(playlist.version).toBe(2);

    mockApply.mockResolvedValueOnce({
      applied: [],
      conflicts: [
        {
          kind: 'playlistVersion',
          playlistId: playlist.id,
          clientBaseVersion: 1,
          serverVersion: 10,
        },
      ],
      snapshot: {
        ...emptySnapshot(),
        playlists: [serverPlaylist({ version: 10, name: 'Server Wins' })],
      },
    });

    const result = await runSync(db);
    expect(result.conflicts).toHaveLength(1);
    expect(result.pushed).toBe(2);
    expect(await pendingSyncOpsQuery(db).fetch()).toHaveLength(0);

    const local = await playlistsQuery(db).fetch();
    expect(local).toHaveLength(1);
    expect(local[0]?.name).toBe('Server Wins');
    expect(local[0]?.version).toBe(10);
  });

  it('removes local playlists absent from the converged snapshot', async () => {
    await createPlaylist(db, { name: 'Doomed' });
    const ops = await pendingSyncOpsQuery(db).fetch();
    mockApply.mockResolvedValueOnce({
      applied: ops.map((op) => op.id),
      conflicts: [],
      snapshot: emptySnapshot(),
    });

    await runSync(db);
    expect(await playlistsQuery(db).fetch()).toHaveLength(0);
  });

  it('reconciles favorites as the authoritative union set', async () => {
    await toggleFavorite(db, 'track', 't1', { title: 'Old' });
    mockApply.mockResolvedValueOnce({
      applied: ['op-fav'],
      conflicts: [],
      snapshot: {
        ...emptySnapshot(),
        favorites: [
          { id: 'f2', targetType: 'artist', targetId: 'a1', title: 'Band', addedAt: 5000 },
        ],
      },
    });

    await runSync(db);
    const favs = await favoritesQuery(db).fetch();
    expect(favs).toHaveLength(1);
    expect(favs[0]?.targetId).toBe('a1');
    expect(favs[0]?.title).toBe('Band');
  });

  it('recreates playlist entries from the server track order', async () => {
    const playlist = await createPlaylist(db, { name: 'Mix' });
    await saveTrack(db, { title: 'Track', sourceKind: 'LOCAL' });
    await addToPlaylist(db, playlist.id, 'x1');

    mockApply.mockResolvedValueOnce({
      applied: ['op-1'],
      conflicts: [],
      snapshot: {
        ...emptySnapshot(),
        playlists: [serverPlaylist({ name: 'Mix', version: 2, trackIds: ['x1', 'x2'] })],
      },
    });

    await runSync(db);
    const entries = await db.collections
      .get<import('../db/models').PlaylistEntry>('playlist_entries')
      .query()
      .fetch();
    expect(entries.map((e) => e.trackId)).toEqual(['x1', 'x2']);
    expect(entries.map((e) => e.position)).toEqual([0, 1]);
  });
});
