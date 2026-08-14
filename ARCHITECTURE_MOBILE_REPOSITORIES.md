# Mobile Architecture - Repository Interfaces

## Core Repository Interfaces

```typescript
// core/repositories/TrackRepository.ts
export interface TrackRepository {
  findById(id: string): Promise<Track | null>;
  findByIds(ids: string[]): Promise<Track[]>;
  search(query: string, options: SearchOptions): Promise<Track[]>;
  getRecentlyPlayed(limit: number): Promise<Track[]>;
  getRecentlyDownloaded(limit: number): Promise<Track[]>;
  getFavorites(limit?: number): Promise<Track[]>;
  getDownloaded(limit?: number): Promise<Track[]>;
  getByArtist(artistId: string): Promise<Track[]>;
  getByAlbum(albumId: string): Promise<Track[]>;
  getByPlaylist(playlistId: string): Promise<Track[]>;
  incrementPlayCount(trackId: string): Promise<void>;
  incrementSkipCount(trackId: string): Promise<void>;
  updateCompletionRate(trackId: string, rate: number): Promise<void>;
  updateDownloadStatus(trackId: string, status: DownloadStatus, path?: string): Promise<void>;
  upsertTrack(track: CanonicalTrack): Promise<Track>;
  deduplicateTracks(tracks: CanonicalTrack[]): Promise<Track[]>;
  getTracksForSync(since?: Date): Promise<Track[]>;
  markSynced(trackId: string): Promise<void>;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  filters?: SearchFilters;
  sort?: 'relevance' | 'popularity' | 'recent' | 'title' | 'artist';
  order?: 'asc' | 'desc';
}

export interface SearchFilters {
  type?: 'song' | 'artist' | 'album' | 'playlist';
  artist?: string;
  album?: string;
  duration?: { min?: number; max?: number };
  availability?: 'all' | 'streamable' | 'downloadable' | 'downloaded';
  downloaded?: boolean;
  favorite?: boolean;
  explicit?: boolean;
}
```

```typescript
// core/repositories/ArtistRepository.ts
export interface ArtistRepository {
  findById(id: string): Promise<Artist | null>;
  findByIds(ids: string[]): Promise<Artist[]>;
  search(query: string, options?: SearchOptions): Promise<Artist[]>;
  getPopular(limit: number): Promise<Artist[]>;
  getRelated(artistId: string): Promise<Artist[]>;
  getFavorites(limit?: number): Promise<Artist[]>;
  getFollowed(limit?: number): Promise<Artist[]>;
  toggleFavorite(artistId: string): Promise<void>;
  follow(artistId: string): Promise<void>;
  unfollow(artistId: string): Promise<void>;
  upsertArtist(artist: CanonicalArtist): Promise<Artist>;
  getArtistsForSync(since?: Date): Promise<Artist[]>;
  markSynced(artistId: string): Promise<void>;
}

export interface CanonicalArtist {
  id: string;
  name: string;
  artworkUrl?: string;
  providerIds: Record<string, string>;
  bio?: string;
  genres: string[];
  followerCount?: number;
}
```

```typescript
// core/repositories/AlbumRepository.ts
export interface AlbumRepository {
  findById(id: string): Promise<AlbumWithTracks | null>;
  findByIds(ids: string[]): Promise<Album[]>;
  search(query: string, options?: SearchOptions): Promise<Album[]>;
  getByArtist(artistId: string): Promise<Album[]>;
  getNewReleases(limit: number): Promise<Album[]>;
  getSaved(limit?: number): Promise<Album[]>;
  toggleSave(albumId: string): Promise<void>;
  upsertAlbum(album: CanonicalAlbum): Promise<Album>;
  getAlbumsForSync(since?: Date): Promise<Album[]>;
  markSynced(albumId: string): Promise<void>;
}

export interface CanonicalAlbum {
  id: string;
  title: string;
  artistId: string;
  artworkUrl?: string;
  releaseYear?: number;
  releaseDate?: Date;
  trackCount: number;
  totalDuration: number;
  providerIds: Record<string, string>;
  type: 'album' | 'single' | 'ep' | 'compilation' | 'soundtrack';
}

export interface AlbumWithTracks extends Album {
  tracks: Track[];
}
```

```typescript
// core/repositories/PlaylistRepository.ts
export interface PlaylistRepository {
  findById(id: string): Promise<PlaylistWithTracks | null>;
  findByIds(ids: string[]): Promise<Playlist[]>;
  getUserPlaylists(userId: string, options?: PaginationOptions): Promise<Playlist[]>;
  getPublicPlaylists(options?: PaginationOptions): Promise<Playlist[]>;
  getCollaborativePlaylists(userId: string): Promise<Playlist[]>;
  create(data: CreatePlaylistInput): Promise<Playlist>;
  update(id: string, data: UpdatePlaylistInput): Promise<Playlist>;
  delete(id: string): Promise<void>;
  addTrack(playlistId: string, trackId: string, position?: number): Promise<void>;
  removeTrack(playlistId: string, trackId: string): Promise<void>;
  reorderTracks(playlistId: string, trackIds: string[]): Promise<void>;
  duplicate(playlistId: string): Promise<Playlist>;
  upsertPlaylist(playlist: CanonicalPlaylist): Promise<Playlist>;
  getPlaylistsForSync(since?: Date): Promise<Playlist[]>;
  markSynced(playlistId: string): Promise<void>;
}

export interface CreatePlaylistInput {
  title: string;
  description?: string;
  artworkUrl?: string;
  isCollaborative?: boolean;
  visibility?: 'private' | 'public' | 'unlisted';
  trackIds?: string[];
}

export interface UpdatePlaylistInput {
  title?: string;
  description?: string;
  artworkUrl?: string;
  isCollaborative?: boolean;
  visibility?: 'private' | 'public' | 'unlisted';
}

export interface CanonicalPlaylist {
  id: string;
  title: string;
  description?: string;
  artworkUrl?: string;
  ownerId: string;
  ownerType: 'user' | 'system' | 'collaborative';
  trackCount: number;
  totalDuration: number;
  visibility: 'private' | 'public' | 'unlisted';
  isCollaborative: boolean;
  trackIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PlaylistWithTracks extends Playlist {
  tracks: PlaylistTrack[];
}
```

```typescript
// core/repositories/FavoriteRepository.ts
export interface FavoriteRepository {
  getTrackFavorites(userId: string, options?: PaginationOptions): Promise<Track[]>;
  getArtistFavorites(userId: string): Promise<Artist[]>;
  getAlbumFavorites(userId: string): Promise<Album[]>;
  isFavorite(userId: string, trackId: string): Promise<boolean>;
  toggleTrack(userId: string, trackId: string): Promise<boolean>; // Returns new state
  toggleArtist(userId: string, artistId: string): Promise<boolean>;
  toggleAlbum(userId: string, albumId: string): Promise<boolean>;
  getFavoritesForSync(since?: Date): Promise<Favorite[]>;
  markSynced(favoriteId: string): Promise<void>;
}

export interface Favorite {
  id: string;
  userId: string;
  entityType: 'track' | 'artist' | 'album';
  entityId: string;
  createdAt: Date;
  syncedAt?: Date;
  serverId?: string;
}
```

```typescript
// core/repositories/PlayHistoryRepository.ts
export interface PlayHistoryRepository {
  recordPlay(history: PlayHistoryEntry): Promise<void>;
  getRecent(limit: number): Promise<PlayHistoryEntry[]>;
  getByTrack(trackId: string, limit?: number): Promise<PlayHistoryEntry[]>;
  getSince(since: Date, limit?: number): Promise<PlayHistoryEntry[]>;
  getUnsynced(since?: Date): Promise<PlayHistoryEntry[]>;
  markSynced(historyId: string): Promise<void>;
  clear(): Promise<void>;
  getStats(): Promise<PlayHistoryStats>;
}

export interface PlayHistoryEntry {
  id: string;
  userId: string;
  trackId: string;
  position: number; // ms when stopped
  completionPercentage: number;
  playedAt: Date;
  sourceType: 'LOCAL' | 'REMOTE' | 'CACHED';
  deviceId?: string;
  syncedAt?: Date;
  serverId?: string;
}

export interface PlayHistoryStats {
  totalPlays: number;
  totalListenTimeMs: number;
  totalSongsPlayed: number;
  topArtists: { artistId: string; playCount: number }[];
  topTracks: { trackId: string; playCount: number }[];
  favoriteGenres: { genre: string; playCount: number }[];
}
```

```typescript
// core/repositories/DownloadRepository.ts
export interface DownloadRepository {
  createJob(job: DownloadJobInput): Promise<DownloadJob>;
  getJob(id: string): Promise<DownloadJob | null>;
  getJobsByStatus(status: DownloadStatus[]): Promise<DownloadJob[]>;
  getQueue(): Promise<DownloadJob[]>;
  getActive(): Promise<DownloadJob[]>;
  getStats(): Promise<DownloadStats>;
  updateJob(id: string, updates: Partial<DownloadJob>): Promise<void>;
  updateProgress(id: string, progress: DownloadProgress): Promise<void>;
  deleteJob(id: string): Promise<void>;
  cleanupExpired(maxAge: number): Promise<number>;
  getJobsForSync(since?: Date): Promise<DownloadJob[]>;
  markSynced(jobId: string): Promise<void>;
}

export interface DownloadJobInput {
  trackId: string;
  priority?: number;
  quality?: DownloadQuality;
  format?: DownloadFormat;
  includeLyrics?: boolean;
  includeSyncedLyrics?: boolean;
  includeArtwork?: boolean;
}

export interface DownloadJob {
  id: string;
  userId: string;
  trackId: string;
  status: DownloadStatus;
  progress: number; // 0-100
  bytesDownloaded: number;
  bytesTotal: number;
  speed: number; // bytes/sec
  retryCount: number;
  errorMessage?: string;
  sourceProvider?: string;
  sourceUrl?: string;
  priority: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  localFilePath?: string;
  artworkPath?: string;
  lyricsPath?: string;
  syncedLyricsPath?: string;
  checksum?: string;
}

export interface DownloadProgress {
  bytesDownloaded: number;
  bytesTotal: number;
  speed: number; // bytes/sec
  percent: number;
}

export interface DownloadStats {
  total: number;
  completed: number;
  active: number;
  queued: number;
  failed: number;
  totalBytes: number;
}
```

```typescript
// core/repositories/SettingsRepository.ts
export interface SettingsRepository {
  getAll(): Promise<Record<string, any>>;
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  setMany(values: Record<string, any>): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  getForSync(): Promise<SettingsEntry[]>;
  markSynced(key: string): Promise<void>;
}
```

```typescript
// core/repositories/RecommendationRepository.ts
export interface RecommendationRepository {
  getForYou(userId: string, options?: PaginationOptions): Promise<Track[]>;
  getSimilar(userId: string, trackId: string, options?: PaginationOptions): Promise<Track[]>;
  getArtistMix(userId: string, artistId: string, options?: PaginationOptions): Promise<Track[]>;
  getGenreMix(userId: string, genre: string, options?: PaginationOptions): Promise<Track[]>;
  getDiscovery(userId: string, options?: PaginationOptions): Promise<Track[]>;
  getQuickMixes(userId: string): Promise<QuickMix[]>;
  getCached(key: string): Promise<unknown | null>;
  setCached(key: string, value: unknown, ttlMs: number): Promise<void>;
}

export interface QuickMix {
  id: string;
  title: string;
  description?: string;
  artworkUrl?: string;
  type: 'favorites' | 'chill' | 'recently_played' | 'discovery' | 'artist' | 'genre';
  trackCount: number;
  seed?: string; // artist or genre seed
}
```

```typescript
// core/repositories/LyricsRepository.ts
export interface LyricsRepository {
  getForTrack(trackId: string): Promise<LyricsResult | null>;
  getSyncedForTrack(trackId: string): Promise<SyncedLyricsResult | null>;
  cacheLyrics(trackId: string, result: LyricsResult): Promise<void>;
  cacheSyncedLyrics(trackId: string, result: SyncedLyricsResult): Promise<void>;
  getCacheStats(): Promise<LyricsCacheStats>;
  clearCache(): Promise<void>;
}
```

## Dependency Injection Container

```typescript
// core/di/container.ts
import { Container } from 'inversify';
import {
  TrackRepository,
  ArtistRepository,
  AlbumRepository,
  PlaylistRepository,
  FavoriteRepository,
  PlayHistoryRepository,
  DownloadRepository,
  SettingsRepository,
  RecommendationRepository,
  LyricsRepository,
} from '@/core/repositories';

export const TYPES = {
  TrackRepository: Symbol.for('TrackRepository'),
  ArtistRepository: Symbol.for('ArtistRepository'),
  AlbumRepository: Symbol.for('AlbumRepository'),
  PlaylistRepository: Symbol.for('PlaylistRepository'),
  FavoriteRepository: Symbol.for('FavoriteRepository'),
  PlayHistoryRepository: Symbol.for('PlayHistoryRepository'),
  DownloadRepository: Symbol.for('DownloadRepository'),
  SettingsRepository: Symbol.for('SettingsRepository'),
  RecommendationRepository: Symbol.for('RecommendationRepository'),
  LyricsRepository: Symbol.for('LyricsRepository'),
  AudioPlayer: Symbol.for('AudioPlayer'),
  DownloadManager: Symbol.for('DownloadManager'),
  Notifications: Symbol.for('Notifications'),
  SecureStorage: Symbol.for('SecureStorage'),
  Haptics: Symbol.for('Haptics'),
  NetworkMonitor: Symbol.for('NetworkMonitor'),
  SyncManager: Symbol.for('SyncManager'),
  ConflictResolver: Symbol.for('ConflictResolver'),
  SourceResolver: Symbol.for('SourceResolver'),
};

const container = new Container();

// Repositories
container.bind<TrackRepository>(TYPES.TrackRepository).to(LocalTrackRepository);
container.bind<ArtistRepository>(TYPES.ArtistRepository).to(LocalArtistRepository);
container.bind<AlbumRepository>(TYPES.AlbumRepository).to(LocalAlbumRepository);
container.bind<PlaylistRepository>(TYPES.PlaylistRepository).to(LocalPlaylistRepository);
container.bind<FavoriteRepository>(TYPES.FavoriteRepository).to(LocalFavoriteRepository);
container.bind<PlayHistoryRepository>(TYPES.PlayHistoryRepository).to(LocalPlayHistoryRepository);
container.bind<DownloadRepository>(TYPES.DownloadRepository).to(LocalDownloadRepository);
container.bind<SettingsRepository>(TYPES.SettingsRepository).to(LocalSettingsRepository);
container
  .bind<RecommendationRepository>(TYPES.RecommendationRepository)
  .to(RemoteRecommendationRepository);
container.bind<LyricsRepository>(TYPES.LyricsRepository).to(LocalLyricsRepository);

// Native Services
container.bind<AudioPlayer>(TYPES.AudioPlayer).to(AudioPlayerImpl);
container.bind<DownloadManager>(TYPES.DownloadManager).to(DownloadManagerImpl);
container.bind<Notifications>(TYPES.Notifications).to(NotificationsImpl);
container.bind<SecureStorage>(TYPES.SecureStorage).to(SecureStorageImpl);
container.bind<Haptics>(TYPES.Haptics).to(HapticsImpl);
container.bind<NetworkMonitor>(TYPES.NetworkMonitor).to(NetworkMonitorImpl);

// Application Services
container.bind<SyncManager>(TYPES.SyncManager).to(SyncManagerImpl);
container.bind<ConflictResolver>(TYPES.ConflictResolver).to(ConflictResolverImpl);
container.bind<SourceResolver>(TYPES.SourceResolver).to(SourceResolverImpl);

export { container };
```
