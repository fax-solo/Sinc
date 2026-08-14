/**
 * Bidirectional sync protocol for playlists + favorites (M3.2).
 *
 * Model: operation-based sync. The client keeps an ordered queue of
 * mutations (written offline-optimistically into its local DB) and pushes
 * them in one /sync/apply request. The server applies them against its own
 * state and answers with the converged snapshot.
 *
 * Conflict model:
 * - Playlists use optimistic-concurrency versioning. Every mutation carries
 *   the baseVersion the client based its change on; if the server version
 *   differs, the mutation is rejected as a conflict and the server state
 *   wins (the client reconciles from the snapshot).
 * - Favorites are a union set keyed by (targetType, targetId); toggles are
 *   idempotent and never conflict. The server state is authoritative.
 */

export type SyncFavoriteTarget = 'track' | 'artist' | 'album';

export interface SyncFavorite {
  /** Client-generated stable id (survives device migration). */
  id: string;
  targetType: SyncFavoriteTarget;
  targetId: string;
  title?: string | null;
  subtitle?: string | null;
  /** Epoch ms, client-set at toggle time. */
  addedAt: number;
}

export interface SyncPlaylist {
  id: string;
  name: string;
  description?: string | null;
  artworkUrl?: string | null;
  isCollaborative: boolean;
  /** Server version; increments on every accepted mutation. */
  version: number;
  /** Ordered track ids. */
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SyncSnapshot {
  playlists: SyncPlaylist[];
  favorites: SyncFavorite[];
  /** Epoch ms of the server. */
  serverTime: number;
}

export type SyncMutation =
  | {
      kind: 'playlistUpsert';
      opId: string;
      playlistId: string;
      /** Playlist version the client based this change on (0 = new). */
      baseVersion: number;
      name: string;
      description?: string | null;
      isCollaborative?: boolean;
      trackIds: string[];
      createdAt: number;
    }
  | {
      kind: 'playlistDelete';
      opId: string;
      playlistId: string;
      baseVersion: number;
    }
  | {
      kind: 'favoriteToggle';
      opId: string;
      targetType: SyncFavoriteTarget;
      targetId: string;
      title?: string | null;
      subtitle?: string | null;
      addedAt: number;
    };

export type SyncConflict = {
  kind: 'playlistVersion';
  playlistId: string;
  clientBaseVersion: number;
  serverVersion: number;
};

export interface SyncApplyResult {
  /** opIds the server applied. */
  applied: string[];
  conflicts: SyncConflict[];
  /** Converged server state after applying. */
  snapshot: SyncSnapshot;
}

/**
 * Pure favorite union: applies a sequence of toggles to a current set.
 * A toggle for an existing (targetType, targetId) removes it; otherwise it
 * is added. Server and client tests both use this to reason about outcomes.
 */
export function favoriteUnion(current: SyncFavorite[], toggles: SyncFavorite[]): SyncFavorite[] {
  const byKey = new Map<string, SyncFavorite>(
    current.map((favorite) => [`${favorite.targetType}:${favorite.targetId}`, favorite]),
  );
  for (const toggle of toggles) {
    const key = `${toggle.targetType}:${toggle.targetId}`;
    if (byKey.has(key)) {
      byKey.delete(key);
    } else {
      byKey.set(key, { ...toggle });
    }
  }
  return [...byKey.values()].sort((a, b) => a.addedAt - b.addedAt);
}
