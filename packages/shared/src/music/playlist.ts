/**
 * Playlist model shared across client and server.
 */

export type PlaylistVisibility = 'PRIVATE' | 'PUBLIC' | 'UNLISTED';

export interface Playlist {
  id: string;
  title: string;
  description?: string;
  artworkUrl?: string;
  ownerId: string;
  ownerType: 'user' | 'system';
  visibility: PlaylistVisibility;
  isCollaborative: boolean;
  trackCount: number;
  totalDurationMs: number;
  /** Optimistic concurrency version - client must send on mutations. */
  version: number;
  isOwner?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreatePlaylistInput {
  title: string;
  description?: string;
  artworkUrl?: string;
  isCollaborative?: boolean;
  visibility?: PlaylistVisibility;
  trackIds?: string[];
}

export interface UpdatePlaylistInput {
  version: number;
  title?: string;
  description?: string;
  artworkUrl?: string;
  visibility?: PlaylistVisibility;
  isCollaborative?: boolean;
}

export interface PlaylistTrackRef {
  playlistId: string;
  trackId: string;
  position: number;
  addedAt?: string;
}
