import { Model, type Query } from '@nozbe/watermelondb';
import { children, field, relation } from '@nozbe/watermelondb/decorators';
import type { Relation } from '@nozbe/watermelondb';
import type { FavoriteTarget } from './schema';

export class Track extends Model {
  static override table = 'tracks';

  static override associations = {
    artists: { type: 'belongs_to' as const, key: 'artist_id' },
    albums: { type: 'belongs_to' as const, key: 'album_id' },
    playlist_entries: { type: 'has_many' as const, foreignKey: 'track_id' },
    favorites: { type: 'has_many' as const, foreignKey: 'target_id' },
    history: { type: 'has_many' as const, foreignKey: 'track_id' },
  };

  @field('title') title!: string;
  @field('normalized_title') normalizedTitle!: string;
  @field('artist_id') artistId!: string | null;
  @field('album_id') albumId!: string | null;
  @field('duration_ms') durationMs!: number | null;
  @field('track_number') trackNumber!: number | null;
  @field('provider_id') providerId!: string | null;
  @field('source_kind') sourceKind!: string;
  @field('uri') uri!: string | null;
  @field('artwork_url') artworkUrl!: string | null;
  @field('added_at') addedAt!: number;

  @relation('artists', 'artist_id') artist!: Relation<Artist>;
  @relation('albums', 'album_id') album!: Relation<Album>;
  @children('playlist_entries') playlistEntries!: Query<PlaylistEntry>;
}

export class Artist extends Model {
  static override table = 'artists';

  static override associations = {
    tracks: { type: 'has_many' as const, foreignKey: 'artist_id' },
    albums: { type: 'has_many' as const, foreignKey: 'artist_id' },
  };

  @field('name') name!: string;
  @field('normalized_name') normalizedName!: string;
  @field('provider_id') providerId!: string | null;
  @field('artwork_url') artworkUrl!: string | null;
  @field('added_at') addedAt!: number;

  @children('tracks') tracks!: Query<Track>;
  @children('albums') albums!: Query<Album>;
}

export class Album extends Model {
  static override table = 'albums';

  static override associations = {
    artists: { type: 'belongs_to' as const, key: 'artist_id' },
    tracks: { type: 'has_many' as const, foreignKey: 'album_id' },
  };

  @field('title') title!: string;
  @field('normalized_title') normalizedTitle!: string;
  @field('artist_id') artistId!: string | null;
  @field('year') year!: number | null;
  @field('provider_id') providerId!: string | null;
  @field('artwork_url') artworkUrl!: string | null;
  @field('added_at') addedAt!: number;

  @relation('artists', 'artist_id') artist!: Relation<Artist>;
  @children('tracks') tracks!: Query<Track>;
}

export class Playlist extends Model {
  static override table = 'playlists';

  static override associations = {
    playlist_entries: { type: 'has_many' as const, foreignKey: 'playlist_id' },
  };

  @field('name') name!: string;
  @field('normalized_name') normalizedName!: string;
  @field('description') description!: string | null;
  @field('artwork_url') artworkUrl!: string | null;
  @field('is_collaborative') isCollaborative!: boolean;
  @field('version') version!: number;
  @field('updated_at') updatedAt!: number;
  @field('created_at') createdAt!: number;

  @children('playlist_entries') entries!: Query<PlaylistEntry>;
}

export class PlaylistEntry extends Model {
  static override table = 'playlist_entries';

  static override associations = {
    playlists: { type: 'belongs_to' as const, key: 'playlist_id' },
    tracks: { type: 'belongs_to' as const, key: 'track_id' },
  };

  @field('playlist_id') playlistId!: string;
  @field('track_id') trackId!: string | null;
  @field('position') position!: number;
  @field('added_at') addedAt!: number;

  @relation('playlists', 'playlist_id') playlist!: Relation<Playlist>;
  @relation('tracks', 'track_id') track!: Relation<Track>;
}

export class Favorite extends Model {
  static override table = 'favorites';

  @field('target_type') targetType!: FavoriteTarget;
  @field('target_id') targetId!: string;
  @field('title') title!: string | null;
  @field('subtitle') subtitle!: string | null;
  @field('created_at') createdAt!: number;
}

export class HistoryEntry extends Model {
  static override table = 'history';

  static override associations = {
    tracks: { type: 'belongs_to' as const, key: 'track_id' },
  };

  @field('track_id') trackId!: string | null;
  @field('title') title!: string | null;
  @field('artist') artist!: string | null;
  @field('position_ms') positionMs!: number | null;
  @field('duration_ms') durationMs!: number | null;
  @field('source_kind') sourceKind!: string | null;
  @field('played_at') playedAt!: number;

  @relation('tracks', 'track_id') track!: Relation<Track>;
}

export class SyncOp extends Model {
  static override table = 'sync_ops';

  @field('kind') kind!: string;
  @field('target_id') targetId!: string;
  /** JSON-serialized SyncMutation payload. */
  @field('payload') payload!: string;
  @field('created_at') createdAt!: number;
}

export class Download extends Model {
  static override table = 'downloads';

  @field('title') title!: string;
  @field('artist') artist!: string | null;
  @field('artwork_url') artworkUrl!: string | null;
  @field('status') status!: string;
  @field('progress_pct') progressPct!: number;
  @field('bytes_downloaded') bytesDownloaded!: number;
  @field('bytes_total') bytesTotal!: number | null;
  @field('error_code') errorCode!: string | null;
  @field('error_message') errorMessage!: string | null;
  @field('quality') quality!: string;
  @field('priority') priority!: number;
  @field('local_uri') localUri!: string | null;
  @field('batch_id') batchId!: string | null;
  @field('added_at') addedAt!: number;
  @field('started_at') startedAt!: number | null;
  @field('completed_at') completedAt!: number | null;
}

export const models = [
  Track,
  Artist,
  Album,
  Playlist,
  PlaylistEntry,
  Favorite,
  HistoryEntry,
  SyncOp,
  Download,
];
