import {
  favoriteUnion,
  type SyncApplyResult,
  type SyncConflict,
  type SyncFavorite,
  type SyncMutation,
  type SyncPlaylist,
  type SyncSnapshot,
} from '@sinc/shared';
import type { SyncStore } from './types.js';

/**
 * Server-side sync engine (M3.2).
 *
 * Playlists: optimistic-concurrency versioning. Each mutation carries the
 * baseVersion the client based its change on; accepted mutations bump the
 * version to baseVersion + 1. A version mismatch rejects the mutation with a
 * playlistVersion conflict — the client then reconciles from the returned
 * snapshot (server state wins).
 *
 * Favorites: union merge via `favoriteUnion` — toggles are idempotent and
 * never conflict.
 */
export class SyncService {
  constructor(private readonly store: SyncStore) {}

  async snapshot(userId: string): Promise<SyncSnapshot> {
    const [playlists, favorites] = await Promise.all([
      this.store.getPlaylists(userId),
      this.store.getFavorites(userId),
    ]);
    return { playlists, favorites, serverTime: Date.now() };
  }

  async apply(userId: string, mutations: SyncMutation[]): Promise<SyncApplyResult> {
    const applied: string[] = [];
    const conflicts: SyncConflict[] = [];

    for (const mutation of mutations) {
      switch (mutation.kind) {
        case 'playlistUpsert': {
          const existing = await this.store.getPlaylist(userId, mutation.playlistId);
          if (existing && existing.version !== mutation.baseVersion) {
            conflicts.push({
              kind: 'playlistVersion',
              playlistId: mutation.playlistId,
              clientBaseVersion: mutation.baseVersion,
              serverVersion: existing.version,
            });
            continue;
          }
          const playlist: SyncPlaylist = {
            id: mutation.playlistId,
            name: mutation.name,
            description: mutation.description ?? existing?.description ?? null,
            artworkUrl: existing?.artworkUrl ?? null,
            isCollaborative: mutation.isCollaborative ?? existing?.isCollaborative ?? false,
            version: mutation.baseVersion + 1,
            trackIds: mutation.trackIds,
            createdAt: existing?.createdAt ?? mutation.createdAt,
            updatedAt: Date.now(),
          };
          await this.store.putPlaylist(userId, playlist);
          applied.push(mutation.opId);
          break;
        }

        case 'playlistDelete': {
          const existing = await this.store.getPlaylist(userId, mutation.playlistId);
          if (!existing) {
            // Idempotent: nothing to delete.
            applied.push(mutation.opId);
            continue;
          }
          if (existing.version !== mutation.baseVersion) {
            conflicts.push({
              kind: 'playlistVersion',
              playlistId: mutation.playlistId,
              clientBaseVersion: mutation.baseVersion,
              serverVersion: existing.version,
            });
            continue;
          }
          await this.store.deletePlaylist(userId, mutation.playlistId);
          applied.push(mutation.opId);
          break;
        }

        case 'favoriteToggle': {
          const toggles: SyncFavorite[] = [
            {
              id: mutation.opId,
              targetType: mutation.targetType,
              targetId: mutation.targetId,
              title: mutation.title ?? null,
              subtitle: mutation.subtitle ?? null,
              addedAt: mutation.addedAt,
            },
          ];
          const current = await this.store.getFavorites(userId);
          await this.store.putFavorites(userId, favoriteUnion(current, toggles));
          applied.push(mutation.opId);
          break;
        }
      }
    }

    return { applied, conflicts, snapshot: await this.snapshot(userId) };
  }
}
