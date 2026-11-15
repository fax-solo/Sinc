export interface CanonicalArtist {
  id: string;
  name: string;
  artworkUrl?: string;
  providerIds: Record<string, string>;
  genres: string[];
  popularityScore?: number;
}

export interface CanonicalAlbum {
  id: string;
  title: string;
  artist: CanonicalArtist;
  artworkUrl?: string;
  releaseDate?: string;
  year?: number;
  trackCount: number;
  providerIds: Record<string, string>;
  type: 'album' | 'single' | 'compilation' | 'ep';
}

export interface CanonicalTrack {
  id: string;
  title: string;
  artists: CanonicalArtist[];
  album?: CanonicalAlbum;
  durationMs: number;
  trackNumber?: number;
  artworkUrl?: string;
  /**
   * Short, provider-hosted preview of the selected recording. Downloads
   * fingerprint this clip and require the finished file to contain the same
   * audio before it is saved.
   */
  previewUrl?: string;
  providerIds: Record<string, string>;
  releaseDate?: string;
  popularityScore?: number;
  explicit: boolean;
  isrc?: string;
}

export interface CanonicalPlaylist {
  id: string;
  name: string;
  description?: string;
  artworkUrl?: string;
  owner: { id: string; name: string };
  isCollaborative: boolean;
  trackCount: number;
  providerIds: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended';

export interface CanonicalUser {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  settings: UserSettings;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  playbackQuality: 'low' | 'medium' | 'high' | 'lossless';
  downloadQuality: 'low' | 'medium' | 'high' | 'lossless';
  downloadOverWifiOnly: boolean;
  autoDownloadFavorites: boolean;
  autoplay: boolean;
  shuffleDefault: boolean;
  repeatDefault: 'off' | 'one' | 'all';
  notifications: {
    downloads: boolean;
    recommendations: boolean;
    account: boolean;
  };
  biometricLock: boolean;
  analyticsEnabled: boolean;
}

export interface PlaybackSource {
  uri: string;
  headers?: Record<string, string>;
  mimeType?: string;
  quality: 'low' | 'medium' | 'high' | 'lossless';
  provider: string;
}

export interface SearchResult {
  tracks: Array<{ track: CanonicalTrack; score: number }>;
  artists: CanonicalArtist[];
  albums: CanonicalAlbum[];
  playlists: CanonicalPlaylist[];
}

export interface SearchSuggestion {
  id: string;
  text: string;
  type: 'song' | 'artist' | 'album' | 'playlist';
  subtitle?: string;
  artworkUrl?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface QueueTrack {
  trackId: string;
  source: 'local' | 'remote' | 'cached';
  title?: string;
  artist?: string;
  artworkUrl?: string;
}

export interface LyricLine {
  /** Start time in milliseconds (0 for unsynced lines). */
  timeMs: number;
  text: string;
}

export interface TrackLyrics {
  trackId: string;
  /** Provider that resolved the lyrics (e.g. "lrclib"), or "none". */
  provider: string;
  synced: boolean;
  language?: string | null;
  /** Synced lines, or [] when only plain text is available. */
  lines: LyricLine[];
  /** Full plain text for unsynced lyrics (may be multi-line). */
  plain?: string;
}

// ---------------------------------------------------------------------------
// Personalization & Music Intelligence System Types
// ---------------------------------------------------------------------------

export type ListeningEventType =
  | 'track_started'
  | 'track_completed'
  | 'track_skipped'
  | 'track_replayed'
  | 'track_liked'
  | 'track_unliked'
  | 'playlist_add'
  | 'playlist_remove'
  | 'artist_followed'
  | 'album_played';

export interface ListeningEvent {
  id: string;
  trackId: string;
  trackTitle?: string;
  artistId?: string;
  artistName: string;
  albumId?: string;
  albumTitle?: string;
  genres?: string[];
  eventType: ListeningEventType;
  timestamp: number;
  playbackDurationMs: number;
  trackDurationMs: number;
  completionRatio: number;
}

export type DiscoveryMode = 'familiar' | 'balanced' | 'exploration';

export interface TasteScore {
  id: string;
  name: string;
  score: number;
  shortTermScore: number;
  longTermScore: number;
  playCount: number;
  completionCount: number;
  skipCount: number;
  lastPlayedAt: number;
}

export interface MusicTasteProfile {
  topArtists: TasteScore[];
  topGenres: TasteScore[];
  topAlbums: TasteScore[];
  favoriteGenres: string[];
  favoriteArtists: string[];
  discoveryMode: DiscoveryMode;
  discoveryPreference: number;
  personalizationEnabled: boolean;
  totalListeningTimeMs: number;
  lastUpdated: number;
}

export type ListeningTimeRange = '7d' | '30d' | '90d' | 'all';

export interface ListeningInsights {
  timeRange: ListeningTimeRange;
  totalMinutes: number;
  playCount: number;
  completionRate: number;
  topArtists: Array<{ name: string; minutes: number; playCount: number }>;
  topGenres: Array<{ name: string; minutes: number; playCount: number }>;
  topTracks: Array<{ trackId: string; title: string; artistName: string; playCount: number }>;
  recentlyDiscoveredArtists: Array<{ name: string; firstPlayedAt: number }>;
}

