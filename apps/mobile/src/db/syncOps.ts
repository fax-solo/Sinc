import { Database, Q, type Query } from '@nozbe/watermelondb';
import type { SyncFavoriteTarget, SyncMutation } from '@sinc/shared';
import { createId } from './schema';
import type { Favorite, Playlist, PlaylistEntry, SyncOp } from './models';

const syncOps = (db: Database) => db.collections.get<SyncOp>('sync_ops');
const playlists = (db: Database) => db.collections.get<Playlist>('playlists');
const entries = (db: Database) => db.collections.get<PlaylistEntry>('playlist_entries');
const favorites = (db: Database) => db.collections.get<Favorite>('favorites');

function playlistEntries(db: Database, playlistId: string): Query<PlaylistEntry> {
  return entries(db).query(Q.where('playlist_id', playlistId), Q.sortBy('position', Q.asc));
}

/**
 * Outgoing sync queue. Every local playlist/favorite mutation also writes a
 * SyncMutation op here (inside the same db.write, so the queue is
 * transactionally consistent with the local state). The sync engine drains
 * the queue in order; the server's version checks make replays safe.
 *
 * Callers must run inside a `db.write` block.
 */

export function enqueueSyncOp(db: Database, mutation: SyncMutation): Promise<SyncOp> {
  return syncOps(db).create((op) => {
    op.kind = mutation.kind;
    op.targetId = 'playlistId' in mutation ? mutation.playlistId : mutation.targetId;
    op.payload = JSON.stringify(mutation);
    op.createdAt = Date.now();
  });
}

/** Oldest-first queue of not-yet-pushed mutations. */
export function pendingSyncOpsQuery(db: Database): Query<SyncOp> {
  return syncOps(db).query(Q.sortBy('created_at', Q.asc));
}

export async function clearSyncOps(db: Database, ops: SyncOp[]): Promise<void> {
  await db.write(async () => {
    await db.batch(...ops.map((op) => op.prepareDestroyPermanently()));
  });
}

/** Playlist upsert op reflecting the current playlist state (version + entries). */
export async function enqueuePlaylistUpsertOp(db: Database, playlistId: string): Promise<void> {
  const playlist = await playlists(db).find(playlistId);
  const trackIds = (await playlistEntries(db, playlistId).fetch())
    .map((entry) => entry.trackId)
    .filter((id): id is string => Boolean(id));
  await enqueueSyncOp(db, {
    kind: 'playlistUpsert',
    opId: createId(),
    playlistId,
    baseVersion: playlist.version - 1,
    name: playlist.name,
    description: playlist.description,
    isCollaborative: playlist.isCollaborative,
    trackIds,
    createdAt: playlist.createdAt,
  });
}

export async function enqueuePlaylistDeleteOp(
  db: Database,
  playlistId: string,
  baseVersion: number,
): Promise<void> {
  await enqueueSyncOp(db, {
    kind: 'playlistDelete',
    opId: createId(),
    playlistId,
    baseVersion,
  });
}

export async function enqueueFavoriteToggleOp(
  db: Database,
  targetType: SyncFavoriteTarget,
  targetId: string,
  meta?: { title?: string | null; subtitle?: string | null },
): Promise<void> {
  await enqueueSyncOp(db, {
    kind: 'favoriteToggle',
    opId: createId(),
    targetType,
    targetId,
    title: meta?.title ?? null,
    subtitle: meta?.subtitle ?? null,
    addedAt: Date.now(),
  });
}

/** Reconcile the local favorites table with the authoritative server set. */
export async function replaceFavorites(
  db: Database,
  incoming: Array<{
    targetType: SyncFavoriteTarget;
    targetId: string;
    title: string | null;
    subtitle: string | null;
    addedAt: number;
  }>,
): Promise<void> {
  await db.write(async () => {
    const existing = await favorites(db).query().fetch();
    await db.batch(...existing.map((favorite) => favorite.prepareDestroyPermanently()));
    await db.batch(
      ...incoming.map((favorite) =>
        favorites(db).prepareCreate((record) => {
          record.targetType = favorite.targetType;
          record.targetId = favorite.targetId;
          record.title = favorite.title;
          record.subtitle = favorite.subtitle;
          record.createdAt = favorite.addedAt;
        }),
      ),
    );
  });
}
