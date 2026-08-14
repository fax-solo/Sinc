/**
 * Canonical music domain model. These are the app-wide neutral types that all
 * provider responses are normalized into. Nothing outside the provider adapters
 * should ever touch provider-specific response shapes.
 */

/** Stable internal app IDs are ULIDs; provider IDs are kept separately. */
export type EntityId = string;

export interface ArtistLite {
  id: EntityId;
  name: string;
  artworkUrl?: string;
}

export interface AlbumLite {
  id: EntityId;
  title: string;
  artistId?: EntityId;
  artworkUrl?: string;
  releaseYear?: number;
}

export interface CanonicalArtist {
  id: EntityId;
  name: string;
  normalizedName: string;
  nameVariants: string[];
  type?: 'person' | 'group' | 'orchestra' | 'choir';
  biography?: string;
  artworkUrl?: string;
  genres: string[];
  followerCount?: number;
  /** provider -> external id (never merged into the canonical id) */
  providerIds: Record<string, string>;
  popularityScore?: number;
  isFavorite?: boolean;
}

export interface CanonicalAlbum {
  id: EntityId;
  title: string;
  normalizedTitle: string;
  type: 'ALBUM' | 'SINGLE' | 'EP' | 'COMPILATION' | 'SOUNDTRACK';
  artistId?: EntityId;
  releaseDate?: string;
  releaseYear?: number;
  totalTracks?: number;
  totalDurationMs?: number;
  artworkUrl?: string;
  label?: string;
  providerIds: Record<string, string>;
  isSaved?: boolean;
}

export interface CanonicalTrack {
  id: EntityId;
  title: string;
  normalizedTitle: string;
  artists: ArtistLite[];
  album?: AlbumLite;
  durationMs: number;
  artworkUrl?: string;
  isrc?: string;
  releaseDate?: string;
  explicit?: boolean;
  version?: string;
  trackNumber?: number;
  discNumber?: number;
  language?: string;
  popularityScore?: number;
  providerIds: Record<string, string>;
  /** Computed during provider merge: how confident we are this is correct. */
  providerConfidence: number;
}

/**
 * Raw provider response shape. Adapters map their HTTP payloads into this
 * before any domain logic runs.
 */
export interface RawTrack {
  provider: string;
  providerId: string;
  title: string;
  artistNames: string[];
  albumTitle?: string;
  albumId?: string;
  durationMs?: number;
  artworkUrl?: string;
  isrc?: string;
  releaseDate?: string;
  explicit?: boolean;
  version?: string;
  trackNumber?: number;
  popularity?: number;
}

export interface RawArtist {
  provider: string;
  providerId: string;
  name: string;
  nameVariants?: string[];
  biography?: string;
  artworkUrl?: string;
  genres?: string[];
  followerCount?: number;
}

export interface RawAlbum {
  provider: string;
  providerId: string;
  title: string;
  artistNames: string[];
  releaseDate?: string;
  totalTracks?: number;
  totalDurationMs?: number;
  artworkUrl?: string;
  type?: CanonicalAlbum['type'];
}

/** Sort/filter options used by both local and remote track search. */
export interface SearchOptions {
  limit?: number;
  offset?: number;
  type?: 'song' | 'artist' | 'album' | 'playlist';
  artist?: string;
  album?: string;
  durationMin?: number;
  durationMax?: number;
  downloaded?: boolean;
  favorite?: boolean;
  sort?: 'relevance' | 'popularity' | 'recent' | 'title' | 'artist';
  order?: 'asc' | 'desc';
}
