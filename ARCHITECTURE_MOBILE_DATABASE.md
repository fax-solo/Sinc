# Mobile Architecture - Local Database (WatermelonDB)

## Database Schema

```typescript
// database/schema.ts
import { createDatabase, Database, Schema } from '@nozbe/watermelondb';
import { SQLiteAdapter } from '@nozbe/watermelondb/adapters/sqlite';
import {
  User,
  Track,
  Artist,
  Album,
  Playlist,
  PlaylistTrack,
  Favorite,
  PlayHistory,
  DownloadJob,
  Setting,
} from './models';

const schema: Schema = {
  version: 1,
  tables: [
    { name: 'users', columns: User.columns },
    { name: 'tracks', columns: Track.columns },
    { name: 'artists', columns: Artist.columns },
    { name: 'albums', columns: Album.columns },
    { name: 'playlists', columns: Playlist.columns },
    { name: 'playlist_tracks', columns: PlaylistTrack.columns },
    { name: 'favorites', columns: Favorite.columns },
    { name: 'play_history', columns: PlayHistory.columns },
    { name: 'download_jobs', columns: DownloadJob.columns },
    { name: 'settings', columns: Setting.columns },
  ],
};

// Create SQLite adapter
const adapter = new SQLiteAdapter({
  schema,
  // In-memory database for testing
  // onCreate: (db) => { console.log('DB created'); },
  // Experimental: use JSI for better performance
  jsi: true,
  // Database name
  dbName: 'sinc',
});

// Create database instance
export const database = createDatabase({
  adapter,
  modelClasses: [
    User,
    Track,
    Artist,
    Album,
    Playlist,
    PlaylistTrack,
    Favorite,
    PlayHistory,
    DownloadJob,
    Setting,
  ],
  // Enable experimental batch operations
  experimentalUseJSI: true,
});

export type SincDatabase = Database;
```

## Model Definitions

### User Model

```typescript
// database/models/User.ts
import { Model } from '@nozbe/watermelondb';
import { field, text, date, readonly, children } from '@nozbe/watermelondb/decorators';
import { Playlist } from './Playlist';
import { Favorite } from './Favorite';
import { PlayHistory } from './PlayHistory';
import { DownloadJob } from './DownloadJob';
import { Setting } from './Setting';

export class User extends Model {
  static table = 'users';
  static associations = {
    playlists: { type: 'has_many' as const, foreignKey: 'owner_id' },
    favorites: { type: 'has_many' as const, foreignKey: 'user_id' },
    playHistory: { type: 'has_many' as const, foreignKey: 'user_id' },
    downloadJobs: { type: 'has_many' as const, foreignKey: 'user_id' },
    settings: { type: 'has_many' as const, foreignKey: 'user_id' },
  } as const;

  @text('email') email!: string;
  @text('username') username!: string;
  @text('avatar_url') avatarUrl?: string;
  @text('role') role!: 'USER' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN';
  @text('settings_json') settingsJson?: string; // JSON string of UserSettings
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
  @readonly @date('synced_at') syncedAt?: Date;

  // Computed properties
  get settings(): UserSettings {
    return this.settingsJson ? JSON.parse(this.settingsJson) : defaultUserSettings;
  }

  set settings(value: UserSettings) {
    this.settingsJson = JSON.stringify(value);
  }

  // Relationships
  @children('playlists') playlists!: Playlist[];
  @children('favorites') favorites!: Favorite[];
  @children('play_history') playHistory!: PlayHistory[];
  @children('download_jobs') downloadJobs!: DownloadJob[];
  @children('settings') settingsRecords!: Setting[];
}

interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  compactMode: boolean;
  reducedMotion: boolean;
  playback: PlaybackSettings;
  downloads: DownloadSettings;
  lyrics: LyricsSettings;
  notifications: NotificationPreferences;
  privacy: PrivacySettings;
  security: SecuritySettings;
}

interface PlaybackSettings {
  autoplay: boolean;
  shuffle: boolean;
  repeat: 'off' | 'one' | 'all';
  crossfade: number; // seconds 0-12
  volumeNormalization: boolean;
  rememberPosition: boolean;
  defaultQuality: 'low' | 'medium' | 'high' | 'lossless';
}

interface DownloadSettings {
  quality: 'low' | 'medium' | 'high' | 'lossless';
  format: 'mp3' | 'm4a' | 'flac' | 'opus';
  wifiOnly: boolean;
  mobileDataAllowed: boolean;
  maxConcurrent: number;
  autoRetry: boolean;
  downloadArtwork: boolean;
  downloadLyrics: boolean;
  downloadSyncedLyrics: boolean;
  embedMetadata: boolean;
  storagePath?: string;
}

interface LyricsSettings {
  showSynced: boolean;
  fontSize: 'small' | 'medium' | 'large';
  timingOffset: number; // milliseconds
  autoScroll: boolean;
  keepScreenOn: boolean;
}

interface NotificationPreferences {
  downloads: boolean;
  recommendations: boolean;
  account: boolean;
  updates: boolean;
  security: boolean;
  playbackEvents: boolean;
}

interface PrivacySettings {
  analytics: boolean;
  history: boolean;
  personalizedRecommendations: boolean;
  notificationPersonalization: boolean;
}

interface SecuritySettings {
  biometricEnabled: boolean;
  biometricForApp: boolean;
  biometricForDownloads: boolean;
  biometricForSettings: boolean;
  sessionTimeout: number; // minutes
}

const defaultUserSettings: UserSettings = {
  theme: 'system',
  compactMode: false,
  reducedMotion: false,
  playback: {
    autoplay: true,
    shuffle: false,
    repeat: 'off',
    crossfade: 0,
    volumeNormalization: true,
    rememberPosition: true,
    defaultQuality: 'high',
  },
  downloads: {
    quality: 'high',
    format: 'm4a',
    wifiOnly: true,
    mobileDataAllowed: false,
    maxConcurrent: 3,
    autoRetry: true,
    downloadArtwork: true,
    downloadLyrics: true,
    downloadSyncedLyrics: true,
    embedMetadata: true,
  },
  lyrics: {
    showSynced: true,
    fontSize: 'medium',
    timingOffset: 0,
    autoScroll: true,
    keepScreenOn: false,
  },
  notifications: {
    downloads: true,
    recommendations: false,
    account: true,
    updates: true,
    security: true,
    playbackEvents: false,
  },
  privacy: {
    analytics: false,
    history: true,
    personalizedRecommendations: true,
    notificationPersonalization: false,
  },
  security: {
    biometricEnabled: false,
    biometricForApp: false,
    biometricForDownloads: false,
    biometricForSettings: false,
    sessionTimeout: 60,
  },
};
```

### Track Model

```typescript
// database/models/Track.ts
import { Model } from '@nozbe/watermelondb';
import { field, text, number, date, readonly, children } from '@nozbe/watermelondb/decorators';
import { PlaylistTrack } from './PlaylistTrack';
import { Favorite } from './Favorite';
import { PlayHistory } from './PlayHistory';
import { DownloadJob } from './DownloadJob';

export class Track extends Model {
  static table = 'tracks';
  static associations = {
    playlistTracks: { type: 'has_many' as const, foreignKey: 'track_id' },
    favorites: { type: 'has_many' as const, foreignKey: 'track_id' },
    playHistory: { type: 'has_many' as const, foreignKey: 'track_id' },
    downloadJobs: { type: 'has_many' as const, foreignKey: 'track_id' },
  } as const;

  // Core metadata
  @text('title') title!: string;
  @text('artist_ids') artistIds!: string; // JSON array of artist IDs
  @text('album_id') albumId?: string;
  @number('duration') duration!: number; // milliseconds

  // Artwork
  @text('artwork_url') artworkUrl?: string;
  @text('artwork_local_path') artworkLocalPath?: string;

  // Identifiers
  @text('isrc') isrc?: string;
  @date('release_date') releaseDate?: Date;
  @text('version') version?: string; // e.g., "Remix", "Acoustic", "Live"
  @text('explicit') explicit!: 'true' | 'false' | 'unknown';

  // Provider IDs (JSON: { provider: external_id })
  @text('provider_ids_json') providerIdsJson!: string;

  // Source & Download
  @text('source_url') sourceUrl?: string; // Remote or local file path
  @text('download_status') downloadStatus!: DownloadStatus;
  @text('local_file_path') localFilePath?: string;
  @text('checksum') checksum?: string; // SHA-256 of audio file
  @number('file_size') fileSize?: number;
  @date('downloaded_at') downloadedAt?: Date;

  // Lyrics
  @text('lyrics_json') lyricsJson?: string; // Cached lyrics (synced + plain)
  @text('synced_lyrics_json') syncedLyricsJson?: string; // Cached synced lyrics

  // Stats
  @number('play_count') playCount!: number;
  @number('skip_count') skipCount!: number;
  @number('completion_rate') completionRate!: number; // 0-1 average
  @date('last_played_at') lastPlayedAt?: Date;
  @date('first_played_at') firstPlayedAt?: Date;

  // Sync
  @readonly @date('synced_at') syncedAt?: Date;
  @text('server_id') serverId?: string; // Backend track ID

  // Relationships
  @children('playlist_tracks') playlistTracks!: PlaylistTrack[];
  @children('favorites') favorites!: Favorite[];
  @children('play_history') playHistory!: PlayHistory[];
  @children('download_jobs') downloadJobs!: DownloadJob[];

  // Computed
  get providerIds(): Record<string, string> {
    return this.providerIdsJson ? JSON.parse(this.providerIdsJson) : {};
  }

  set providerIds(value: Record<string, string>) {
    this.providerIdsJson = JSON.stringify(value);
  }

  get artists(): string[] {
    return this.artistIds ? JSON.parse(this.artistIds) : [];
  }

  set artists(value: string[]) {
    this.artistIds = JSON.stringify(value);
  }

  get lyrics(): CachedLyrics | null {
    return this.lyricsJson ? JSON.parse(this.lyricsJson) : null;
  }

  set lyrics(value: CachedLyrics | null) {
    this.lyricsJson = value ? JSON.stringify(value) : undefined;
  }

  get syncedLyrics(): SyncedLyrics | null {
    return this.syncedLyricsJson ? JSON.parse(this.syncedLyricsJson) : null;
  }

  set syncedLyrics(value: SyncedLyrics | null) {
    this.syncedLyricsJson = value ? JSON.stringify(value) : undefined;
  }
}

type DownloadStatus =
  | 'NOT_DOWNLOADED'
  | 'QUEUED'
  | 'RESOLVING'
  | 'DOWNLOADING'
  | 'PROCESSING'
  | 'FETCHING_LYRICS'
  | 'FINALIZING'
  | 'DOWNLOADED'
  | 'FAILED';

interface CachedLyrics {
  text: string;
  language?: string;
  provider: string;
  fetchedAt: number;
  matchConfidence: number; // 0-1
}

interface SyncedLyrics {
  lines: SyncedLyricLine[];
  provider: string;
  fetchedAt: number;
  offset: number; // milliseconds
}

interface SyncedLyricLine {
  time: number; // milliseconds from start
  text: string;
  endTime?: number;
}
```

### Artist Model

```typescript
// database/models/Artist.ts
import { Model } from '@nozbe/watermelondb';
import { field, text, number, date, readonly, children } from '@nozbe/watermelondb/decorators';

export class Artist extends Model {
  static table = 'artists';
  static associations = {} as const;

  @text('name') name!: string;
  @text('artwork_url') artworkUrl?: string;
  @text('artwork_local_path') artworkLocalPath?: string;
  @text('provider_ids_json') providerIdsJson!: string;
  @text('bio') bio?: string;
  @text('genres_json') genresJson?: string; // JSON array
  @number('play_count') playCount!: number;
  @number('follower_count') followerCount?: number;
  @text('is_favorite') isFavorite!: 'true' | 'false';
  @date('last_played_at') lastPlayedAt?: Date;
  @readonly @date('synced_at') syncedAt?: Date;
  @text('server_id') serverId?: string;

  get providerIds(): Record<string, string> {
    return this.providerIdsJson ? JSON.parse(this.providerIdsJson) : {};
  }

  set providerIds(value: Record<string, string>) {
    this.providerIdsJson = JSON.stringify(value);
  }

  get genres(): string[] {
    return this.genresJson ? JSON.parse(this.genresJson) : [];
  }

  set genres(value: string[]) {
    this.genresJson = JSON.stringify(value);
  }

  get isFavoriteBool(): boolean {
    return this.isFavorite === 'true';
  }

  set isFavoriteBool(value: boolean) {
    this.isFavorite = value ? 'true' : 'false';
  }
}
```

### Album Model

```typescript
// database/models/Album.ts
import { Model } from '@nozbe/watermelondb';
import { field, text, number, date, readonly } from '@nozbe/watermelondb/decorators';

export class Album extends Model {
  static table = 'albums';
  static associations = {} as const;

  @text('title') title!: string;
  @text('artist_id') artistId!: string;
  @text('artwork_url') artworkUrl?: string;
  @text('artwork_local_path') artworkLocalPath?: string;
  @number('release_year') releaseYear?: number;
  @date('release_date') releaseDate?: Date;
  @number('track_count') trackCount!: number;
  @number('total_duration') totalDuration!: number; // milliseconds
  @text('provider_ids_json') providerIdsJson!: string;
  @text('type') type!: 'album' | 'single' | 'ep' | 'compilation' | 'soundtrack';
  @text('is_saved') isSaved!: 'true' | 'false';
  @readonly @date('synced_at') syncedAt?: Date;
  @text('server_id') serverId?: string;

  get providerIds(): Record<string, string> {
    return this.providerIdsJson ? JSON.parse(this.providerIdsJson) : {};
  }

  set providerIds(value: Record<string, string>) {
    this.providerIdsJson = JSON.stringify(value);
  }

  get isSavedBool(): boolean {
    return this.isSaved === 'true';
  }

  set isSavedBool(value: boolean) {
    this.isSaved = value ? 'true' : 'false';
  }
}
```

### Playlist Model

```typescript
// database/models/Playlist.ts
import { Model } from '@nozbe/watermelondb';
import { field, text, number, date, readonly, children } from '@nozbe/watermelondb/decorators';
import { PlaylistTrack } from './PlaylistTrack';

export class Playlist extends Model {
  static table = 'playlists';
  static associations = {
    tracks: { type: 'has_many' as const, foreignKey: 'playlist_id' },
  } as const;

  @text('title') title!: string;
  @text('description') description?: string;
  @text('artwork_url') artworkUrl?: string;
  @text('artwork_local_path') artworkLocalPath?: string;
  @text('owner_id') ownerId!: string;
  @text('owner_type') ownerType!: 'user' | 'system' | 'collaborative';
  @number('track_count') trackCount!: number;
  @number('total_duration') totalDuration!: number; // milliseconds
  @text('visibility') visibility!: 'private' | 'public' | 'unlisted';
  @text('is_collaborative') isCollaborative!: 'true' | 'false';
  @text('is_owner') isOwner!: 'true' | 'false';
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
  @readonly @date('synced_at') syncedAt?: Date;
  @text('server_id') serverId?: string;

  @children('playlist_tracks') tracks!: PlaylistTrack[];

  get isCollaborativeBool(): boolean {
    return this.isCollaborative === 'true';
  }

  get isOwnerBool(): boolean {
    return this.isOwner === 'true';
  }
}
```

### PlaylistTrack Model (Join Table with Order)

```typescript
// database/models/PlaylistTrack.ts
import { Model } from '@nozbe/watermelondb';
import { field, text, number, date, readonly } from '@nozbe/watermelondb/decorators';

export class PlaylistTrack extends Model {
  static table = 'playlist_tracks';
  static associations = {} as const;

  @text('playlist_id') playlistId!: string;
  @text('track_id') trackId!: string;
  @number('position') position!: number;
  @date('added_at') addedAt!: Date;
  @text('added_by') addedBy?: string; // User ID
  @readonly @date('synced_at') syncedAt?: Date;
}
```

### Favorite Model

```typescript
// database/models/Favorite.ts
import { Model } from '@nozbe/watermelondb';
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators';

export class Favorite extends Model {
  static table = 'favorites';
  static associations = {} as const;

  @text('user_id') userId!: string;
  @text('track_id') trackId!: string;
  @date('created_at') createdAt!: Date;
  @readonly @date('synced_at') syncedAt?: Date;
  @text('server_id') serverId?: string;
}
```

### PlayHistory Model

```typescript
// database/models/PlayHistory.ts
import { Model } from '@nozbe/watermelondb';
import { field, text, number, date, readonly } from '@nozbe/watermelondb/decorators';

export class PlayHistory extends Model {
  static table = 'play_history';
  static associations = {} as const;

  @text('user_id') userId!: string;
  @text('track_id') trackId!: string;
  @number('position') position!: number; // Playback position when stopped (ms)
  @number('completion_percentage') completionPercentage!: number; // 0-100
  @date('played_at') playedAt!: Date;
  @text('source_type') sourceType!: 'LOCAL' | 'REMOTE' | 'CACHED';
  @text('device_id') deviceId?: string;
  @readonly @date('synced_at') syncedAt?: Date;
  @text('server_id') serverId?: string;
}
```

### DownloadJob Model

```typescript
// database/models/DownloadJob.ts
import { Model } from '@nozbe/watermelondb';
import { field, text, number, date, readonly } from '@nozbe/watermelondb/decorators';

export type DownloadJobStatus =
  | 'QUEUED'
  | 'RESOLVING'
  | 'DOWNLOADING'
  | 'PROCESSING'
  | 'FETCHING_LYRICS'
  | 'FINALIZING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'PAUSED'
  | 'EXPIRED';

export class DownloadJob extends Model {
  static table = 'download_jobs';
  static associations = {} as const;

  @text('user_id') userId!: string;
  @text('track_id') trackId!: string;
  @text('status') status!: DownloadJobStatus;
  @number('progress') progress!: number; // 0-100
  @number('bytes_downloaded') bytesDownloaded!: number;
  @number('bytes_total') bytesTotal!: number;
  @number('speed') speed!: number; // bytes/sec
  @number('retry_count') retryCount!: number;
  @text('error_message') errorMessage?: string;
  @text('source_provider') sourceProvider?: string;
  @text('source_url') sourceUrl?: string;
  @number('priority') priority!: number; // Higher = more important
  @date('created_at') createdAt!: Date;
  @date('started_at') startedAt?: Date;
  @date('completed_at') completedAt?: Date;
  @text('local_file_path') localFilePath?: string;
  @text('artwork_path') artworkPath?: string;
  @text('lyrics_path') lyricsPath?: string;
  @text('synced_lyrics_path') syncedLyricsPath?: string;
  @text('checksum') checksum?: string;
  @readonly @date('synced_at') syncedAt?: Date;
  @text('server_id') serverId?: string;
}
```

### Setting Model (Key-Value Store)

```typescript
// database/models/Setting.ts
import { Model } from '@nozbe/watermelondb';
import { field, text, readonly } from '@nozbe/watermelondb/decorators';

export class Setting extends Model {
  static table = 'settings';
  static associations = {} as const;

  @text('user_id') userId!: string;
  @text('key') key!: string;
  @text('value') value!: string; // JSON string
  @readonly @date('updated_at') updatedAt!: Date;
}
```

## Database Operations

### Repository Implementations

```typescript
// database/repositories/TrackRepository.ts
import { database } from '../schema';
import { Track, Track as TrackModel } from '../models/Track';
import { Q } from '@nozbe/watermelondb';

export class TrackRepository {
  private collection = database.get<Track>('tracks');

  async findById(id: string): Promise<Track | null> {
    return this.collection
      .find(id)
      .fetch()
      .catch(() => null);
  }

  async findByIds(ids: string[]): Promise<Track[]> {
    return this.collection.query(Q.where('id', Q.oneOf(ids))).fetch();
  }

  async search(query: string, options: SearchOptions = {}): Promise<Track[]> {
    const { limit = 50, offset = 0, filters } = options;

    let q = this.collection.query(
      Q.where('title', Q.like(`%${query}%`)),
      Q.or('artists', Q.like(`%${query}%`)),
      Q.or('album', Q.like(`%${query}%`)),
      Q.take(limit),
      Q.skip(offset),
      Q.unsafeSqlOrderBy('play_count DESC'),
    );

    if (filters?.downloaded) {
      q = q.extend(Q.where('download_status', 'DOWNLOADED'));
    }
    if (filters?.favorite) {
      // Join with favorites table
    }

    return q.fetch();
  }

  async getRecentlyPlayed(limit: number = 20): Promise<Track[]> {
    return this.collection
      .query(
        Q.where('last_played_at', Q.notEq(null)),
        Q.sortBy('last_played_at', Q.desc),
        Q.take(limit),
      )
      .fetch();
  }

  async getRecentlyDownloaded(limit: number = 20): Promise<Track[]> {
    return this.collection
      .query(
        Q.where('download_status', 'DOWNLOADED'),
        Q.where('downloaded_at', Q.notEq(null)),
        Q.sortBy('downloaded_at', Q.desc),
        Q.take(limit),
      )
      .fetch();
  }

  async getFavorites(limit?: number): Promise<Track[]> {
    // Join with favorites table
    const favoriteTrackIds = await database
      .get<Favorite>('favorites')
      .query(Q.take(limit || 1000))
      .fetch()
      .then((favs) => favs.map((f) => f.trackId));

    if (favoriteTrackIds.length === 0) return [];

    return this.collection
      .query(Q.where('id', Q.oneOf(favoriteTrackIds)), Q.take(limit || 1000))
      .fetch();
  }

  async getDownloaded(limit?: number): Promise<Track[]> {
    return this.collection
      .query(Q.where('download_status', 'DOWNLOADED'), Q.take(limit || 1000))
      .fetch();
  }

  async getByArtist(artistId: string): Promise<Track[]> {
    return this.collection
      .query(
        Q.where('artist_ids', Q.like(`%"${artistId}"%`)), // JSON contains
        Q.take(100),
      )
      .fetch();
  }

  async getByAlbum(albumId: string): Promise<Track[]> {
    return this.collection.query(Q.where('album_id', albumId), Q.take(100)).fetch();
  }

  async incrementPlayCount(trackId: string): Promise<void> {
    const track = await this.findById(trackId);
    if (track) {
      await database.write(async () => {
        await track.update((t) => {
          t.playCount = t.playCount + 1;
          t.lastPlayedAt = new Date();
          if (!t.firstPlayedAt) t.firstPlayedAt = new Date();
        });
      });
    }
  }

  async updateDownloadStatus(
    trackId: string,
    status: Track['downloadStatus'],
    path?: string,
  ): Promise<void> {
    const track = await this.findById(trackId);
    if (track) {
      await database.write(async () => {
        await track.update((t) => {
          t.downloadStatus = status;
          if (path) t.localFilePath = path;
          if (status === 'DOWNLOADED') t.downloadedAt = new Date();
        });
      });
    }
  }

  async upsertTrack(track: CanonicalTrack): Promise<Track> {
    return database.write(async () => {
      const existing = await this.findById(track.id);
      if (existing) {
        await existing.update((t) => {
          t.title = track.title;
          t.artists = track.artistIds;
          t.albumId = track.albumId;
          t.duration = track.duration;
          t.artworkUrl = track.artworkUrl;
          t.isrc = track.isrc;
          t.releaseDate = track.releaseDate;
          t.version = track.version;
          t.explicit = track.explicit;
          t.providerIds = track.providerIds;
        });
        return existing;
      } else {
        return this.collection.create((t) => {
          t.id = track.id;
          t.title = track.title;
          t.artists = track.artistIds;
          t.albumId = track.albumId;
          t.duration = track.duration;
          t.artworkUrl = track.artworkUrl;
          t.isrc = track.isrc;
          t.releaseDate = track.releaseDate;
          t.version = track.version;
          t.explicit = track.explicit;
          t.providerIds = track.providerIds;
          t.downloadStatus = 'NOT_DOWNLOADED';
          t.playCount = 0;
          t.skipCount = 0;
          t.completionRate = 0;
        });
      }
    });
  }

  async deduplicateTracks(tracks: CanonicalTrack[]): Promise<Track[]> {
    // Group by ISRC or (title + artist + duration)
    const groups = new Map<string, CanonicalTrack[]>();

    for (const track of tracks) {
      const key = track.isrc || `${track.title}|${track.artistIds.join(',')}|${track.duration}`;
      const existing = groups.get(key) || [];
      existing.push(track);
      groups.set(key, existing);
    }

    // For each group, pick the best match (highest confidence, most complete)
    const results: Track[] = [];
    for (const [, group] of groups) {
      const best = group.sort(
        (a, b) => (b.providerConfidence || 0) - (a.providerConfidence || 0),
      )[0];
      const saved = await this.upsertTrack(best);
      results.push(saved);
    }

    return results;
  }
}
```

### Database Persister for TanStack Query

```typescript
// database/watermelonPersister.ts
import { Persister } from '@tanstack/query-sync-storage-persister';
import { database } from './schema';

export function createWatermelonPersister(db: typeof database): Persister {
  return {
    persistClient: async (client) => {
      // Store in a dedicated settings record
      await db.write(async () => {
        const settings = db.get<Setting>('settings');
        await settings.create((s) => {
          s.userId = 'global';
          s.key = 'tanstack_query_cache';
          s.value = JSON.stringify(client);
          s.updatedAt = new Date();
        });
      });
    },
    restoreClient: async () => {
      const settings = db.get<Setting>('settings');
      const record = await settings
        .query(Q.where('key', 'tanstack_query_cache'), Q.where('user_id', 'global'))
        .fetch();

      if (record.length > 0) {
        return JSON.parse(record[0].value);
      }
      return undefined;
    },
    removeClient: async () => {
      await db.write(async () => {
        const settings = db.get<Setting>('settings');
        const records = await settings
          .query(Q.where('key', 'tanstack_query_cache'), Q.where('user_id', 'global'))
          .fetch();
        await db.batch(...records.map((r) => r.prepareDestroyPermanently()));
      });
    },
  };
}
```

## Migrations

```typescript
// database/migrations.ts
import { Migration } from '@nozbe/watermelondb/Schema/migrations';

export const migrations: Migration[] = [
  // Version 1 - Initial schema
  {
    toVersion: 1,
    steps: [
      // All tables created in schema.ts
    ],
  },

  // Version 2 - Add synced_lyrics to tracks
  {
    toVersion: 2,
    steps: [
      { type: 'add_column', table: 'tracks', column: 'synced_lyrics_json', type: 'text' },
      { type: 'add_column', table: 'tracks', column: 'skip_count', type: 'integer', default: 0 },
      { type: 'add_column', table: 'tracks', column: 'completion_rate', type: 'real', default: 0 },
      { type: 'add_column', table: 'tracks', column: 'first_played_at', type: 'datetime' },
    ],
  },

  // Version 3 - Add user_id to download_jobs
  {
    toVersion: 3,
    steps: [{ type: 'add_column', table: 'download_jobs', column: 'user_id', type: 'text' }],
  },

  // Version 4 - Add server_id columns for sync
  {
    toVersion: 4,
    steps: [
      { type: 'add_column', table: 'users', column: 'server_id', type: 'text' },
      { type: 'add_column', table: 'tracks', column: 'server_id', type: 'text' },
      { type: 'add_column', table: 'artists', column: 'server_id', type: 'text' },
      { type: 'add_column', table: 'albums', column: 'server_id', type: 'text' },
      { type: 'add_column', table: 'playlists', column: 'server_id', type: 'text' },
      { type: 'add_column', table: 'favorites', column: 'server_id', type: 'text' },
      { type: 'add_column', table: 'play_history', column: 'server_id', type: 'text' },
      { type: 'add_column', table: 'download_jobs', column: 'server_id', type: 'text' },
    ],
  },
];
```
