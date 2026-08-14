import type { SyncFavorite, SyncPlaylist } from '@sinc/shared';
import type { SyncStore } from '../domain/sync/types.js';

/**
 * In-memory per-user sync store (dev/test default). Swap for a durable
 * implementation when a persistence layer is introduced.
 */
export class MemorySyncStore implements SyncStore {
  private readonly playlistsByUser = new Map<string, Map<string, SyncPlaylist>>();
  private readonly favoritesByUser = new Map<string, Map<string, SyncFavorite>>();

  private playlistsOf(userId: string): Map<string, SyncPlaylist> {
    let map = this.playlistsByUser.get(userId);
    if (!map) {
      map = new Map();
      this.playlistsByUser.set(userId, map);
    }
    return map;
  }

  private favoritesOf(userId: string): Map<string, SyncFavorite> {
    let map = this.favoritesByUser.get(userId);
    if (!map) {
      map = new Map();
      this.favoritesByUser.set(userId, map);
    }
    return map;
  }

  async getPlaylists(userId: string): Promise<SyncPlaylist[]> {
    return [...this.playlistsOf(userId).values()];
  }

  async getPlaylist(userId: string, playlistId: string): Promise<SyncPlaylist | null> {
    return this.playlistsOf(userId).get(playlistId) ?? null;
  }

  async putPlaylist(userId: string, playlist: SyncPlaylist): Promise<void> {
    this.playlistsOf(userId).set(playlist.id, playlist);
  }

  async deletePlaylist(userId: string, playlistId: string): Promise<void> {
    this.playlistsOf(userId).delete(playlistId);
  }

  async getFavorites(userId: string): Promise<SyncFavorite[]> {
    return [...this.favoritesOf(userId).values()];
  }

  async putFavorites(userId: string, favorites: SyncFavorite[]): Promise<void> {
    const map = this.favoritesOf(userId);
    map.clear();
    for (const favorite of favorites) {
      map.set(`${favorite.targetType}:${favorite.targetId}`, favorite);
    }
  }
}
