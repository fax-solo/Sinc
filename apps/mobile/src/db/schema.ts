import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * Local library schema (WatermelonDB). Covers the whole library domain:
 * tracks/artists/albums, playlists (+ entries), favorites, play history, the
 * outgoing sync queue and download jobs.
 *
 * Version 2 - M3.2: added `sync_ops`.
 * Version 3 - M3.3/M4.2: added `downloads` (persisted download jobs).
 */
export const librarySchema = appSchema({
  version: 3,
  tables: [
    tableSchema({
      name: 'tracks',
      columns: [
        { name: 'title', type: 'string' },
        { name: 'normalized_title', type: 'string' },
        { name: 'artist_id', type: 'string', isOptional: true },
        { name: 'album_id', type: 'string', isOptional: true },
        { name: 'duration_ms', type: 'number', isOptional: true },
        { name: 'track_number', type: 'number', isOptional: true },
        { name: 'provider_id', type: 'string', isOptional: true },
        { name: 'source_kind', type: 'string' },
        { name: 'uri', type: 'string', isOptional: true },
        { name: 'artwork_url', type: 'string', isOptional: true },
        { name: 'added_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'artists',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'normalized_name', type: 'string' },
        { name: 'provider_id', type: 'string', isOptional: true },
        { name: 'artwork_url', type: 'string', isOptional: true },
        { name: 'added_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'albums',
      columns: [
        { name: 'title', type: 'string' },
        { name: 'normalized_title', type: 'string' },
        { name: 'artist_id', type: 'string', isOptional: true },
        { name: 'year', type: 'number', isOptional: true },
        { name: 'provider_id', type: 'string', isOptional: true },
        { name: 'artwork_url', type: 'string', isOptional: true },
        { name: 'added_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'playlists',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'normalized_name', type: 'string' },
        { name: 'description', type: 'string', isOptional: true },
        { name: 'artwork_url', type: 'string', isOptional: true },
        { name: 'is_collaborative', type: 'boolean' },
        { name: 'version', type: 'number' },
        { name: 'updated_at', type: 'number' },
        { name: 'created_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'playlist_entries',
      columns: [
        { name: 'playlist_id', type: 'string' },
        { name: 'track_id', type: 'string', isOptional: true },
        { name: 'position', type: 'number' },
        { name: 'added_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'favorites',
      columns: [
        { name: 'target_type', type: 'string' },
        { name: 'target_id', type: 'string' },
        { name: 'title', type: 'string', isOptional: true },
        { name: 'subtitle', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'history',
      columns: [
        { name: 'track_id', type: 'string', isOptional: true },
        { name: 'title', type: 'string', isOptional: true },
        { name: 'artist', type: 'string', isOptional: true },
        { name: 'position_ms', type: 'number', isOptional: true },
        { name: 'duration_ms', type: 'number', isOptional: true },
        { name: 'source_kind', type: 'string', isOptional: true },
        { name: 'played_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'sync_ops',
      columns: [
        { name: 'kind', type: 'string' },
        { name: 'target_id', type: 'string' },
        { name: 'payload', type: 'string' },
        { name: 'created_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'downloads',
      columns: [
        { name: 'title', type: 'string' },
        { name: 'artist', type: 'string', isOptional: true },
        { name: 'artwork_url', type: 'string', isOptional: true },
        { name: 'status', type: 'string' },
        { name: 'progress_pct', type: 'number' },
        { name: 'bytes_downloaded', type: 'number' },
        { name: 'bytes_total', type: 'number', isOptional: true },
        { name: 'error_code', type: 'string', isOptional: true },
        { name: 'error_message', type: 'string', isOptional: true },
        { name: 'quality', type: 'string' },
        { name: 'priority', type: 'number' },
        { name: 'local_uri', type: 'string', isOptional: true },
        { name: 'batch_id', type: 'string', isOptional: true },
        { name: 'added_at', type: 'number' },
        { name: 'started_at', type: 'number', isOptional: true },
        { name: 'completed_at', type: 'number', isOptional: true },
      ],
    }),
  ],
});

export type FavoriteTarget = 'track' | 'artist' | 'album';

export const FAVORITE_TARGETS: readonly FavoriteTarget[] = ['track', 'artist', 'album'];

export function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
