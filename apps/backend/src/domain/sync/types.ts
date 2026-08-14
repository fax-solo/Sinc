import type { SyncFavorite, SyncPlaylist } from '@sinc/shared';

/**
 * Per-user sync state. The store is the server-side mirror of the client
 * library: playlists (versioned) + favorites (union). Implementations must
 * isolate users from each other.
 */
export interface SyncStore {
  getPlaylists(userId: string): Promise<SyncPlaylist[]>;
  getPlaylist(userId: string, playlistId: string): Promise<SyncPlaylist | null>;
  putPlaylist(userId: string, playlist: SyncPlaylist): Promise<void>;
  deletePlaylist(userId: string, playlistId: string): Promise<void>;
  getFavorites(userId: string): Promise<SyncFavorite[]>;
  putFavorites(userId: string, favorites: SyncFavorite[]): Promise<void>;
}
