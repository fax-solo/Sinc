import { Database, Q } from '@nozbe/watermelondb';
import type { SyncConflict, SyncMutation, SyncSnapshot } from '@sinc/shared';
import { applySyncMutations, getSyncSnapshot } from '../api/sync';
import { normalizeName } from './schema';
import type { Playlist } from './models';
import { clearSyncOps, pendingSyncOpsQuery, replaceFavorites } from './syncOps';

export interface SyncRunResult {
  pushed: number;
  applied: string[];
  conflicts: SyncConflict[];
  pulledPlaylists: number;
  pulledFavorites: number;
}

const playlists = (db: Database) => db.collections.get<Playlist>('playlists');
const entries = (db: Database) =>
  db.collections.get<import('./models').PlaylistEntry>('playlist_entries');

/**
 * Bidirectional sync (M3.2). Order matters:
 *
 * 1. Push — drain the outgoing queue in order. The server applies mutations
 *    against its versioned state and answers with the converged snapshot.
 *    Version conflicts are reported (not fatal): the server state wins and
 *    the conflicted local mutations are dropped, then reconciled below.
 * 2. Pull — reconcile the returned snapshot into the local DB: playlists
 *    (and their ordered entries) and the favorite union set. Local playlists
 *    missing from the server are removed — safe because the push already
 *    sent every local change (a failed push aborts before the pull).
 *
 * Not authed/offline? Callers should gate on auth + network state.
 */
export async function runSync(db: Database): Promise<SyncRunResult> {
  const queue = await pendingSyncOpsQuery(db).fetch();
  const mutations: SyncMutation[] = queue.map((op) => JSON.parse(op.payload) as SyncMutation);

  let snapshot: SyncSnapshot;
  let applied: string[] = [];
  let conflicts: SyncConflict[] = [];

  if (mutations.length > 0) {
    const result = await applySyncMutations(mutations);
    applied = result.applied;
    conflicts = result.conflicts;
    snapshot = result.snapshot;
  } else {
    snapshot = await getSyncSnapshot();
  }

  if (queue.length > 0) {
    await clearSyncOps(db, queue);
  }

  const reconciled = await reconcile(db, snapshot);
  return {
    pushed: queue.length,
    applied,
    conflicts,
    pulledPlaylists: reconciled.playlists,
    pulledFavorites: reconciled.favorites,
  };
}

async function reconcile(
  db: Database,
  snapshot: SyncSnapshot,
): Promise<{ playlists: number; favorites: number }> {
  let pulledPlaylists = 0;
  await db.write(async () => {
    const localPlaylists = await playlists(db).query().fetch();
    const serverIds = new Set(snapshot.playlists.map((playlist) => playlist.id));

    for (const playlist of localPlaylists) {
      if (!serverIds.has(playlist.id)) {
        const orphans = await entries(db).query(Q.where('playlist_id', playlist.id)).fetch();
        await db.batch(...orphans.map((entry) => entry.prepareDestroyPermanently()));
        await playlist.destroyPermanently();
      }
    }

    for (const serverPlaylist of snapshot.playlists) {
      const local = await playlists(db)
        .find(serverPlaylist.id)
        .catch(() => null);
      const stored = await upsertPlaylist(db, local, serverPlaylist);
      await replaceEntries(db, stored.id, serverPlaylist.trackIds);
      pulledPlaylists += 1;
    }
  });

  await replaceFavorites(
    db,
    snapshot.favorites.map((favorite) => ({
      targetType: favorite.targetType,
      targetId: favorite.targetId,
      title: favorite.title ?? null,
      subtitle: favorite.subtitle ?? null,
      addedAt: favorite.addedAt,
    })),
  );

  return { playlists: pulledPlaylists, favorites: snapshot.favorites.length };
}

function upsertPlaylist(
  db: Database,
  local: Playlist | null,
  server: SyncSnapshot['playlists'][number],
): Promise<Playlist> {
  if (!local) {
    // Keep the server's id so both sides reference the same playlist.
    return db
      .batch(
        playlists(db).prepareCreateFromDirtyRaw({
          id: server.id,
          _status: 'created',
          _changed: '',
          name: server.name,
          normalized_name: normalizeName(server.name),
          description: server.description ?? null,
          artwork_url: server.artworkUrl ?? null,
          is_collaborative: server.isCollaborative,
          version: server.version,
          updated_at: server.updatedAt,
          created_at: server.createdAt,
        }),
      )
      .then(() => playlists(db).find(server.id));
  }
  return local.update((playlist) => {
    playlist.name = server.name;
    playlist.normalizedName = normalizeName(server.name);
    playlist.description = server.description ?? null;
    playlist.isCollaborative = server.isCollaborative;
    playlist.version = server.version;
    playlist.updatedAt = server.updatedAt;
    playlist.createdAt = server.createdAt;
  });
}

async function replaceEntries(db: Database, playlistId: string, trackIds: string[]): Promise<void> {
  const existing = await entries(db).query(Q.where('playlist_id', playlistId)).fetch();
  await db.batch(...existing.map((entry) => entry.prepareDestroyPermanently()));
  await db.batch(
    ...trackIds.map((trackId, position) =>
      entries(db).prepareCreate((entry) => {
        entry.playlistId = playlistId;
        entry.trackId = trackId;
        entry.position = position;
        entry.addedAt = Date.now();
      }),
    ),
  );
}
