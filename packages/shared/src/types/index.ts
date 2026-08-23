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
