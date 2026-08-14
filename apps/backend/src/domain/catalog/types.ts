import type {
  RawAlbum,
  RawArtist,
  RawTrack,
  SourceCandidate,
  SourceInfo,
  CanonicalTrack,
} from '@sinc/shared';

export type ProviderKind = 'metadata' | 'source' | 'lyrics';

export interface PageOpts {
  limit?: number;
  offset?: number;
}

export interface SearchOpts extends PageOpts {
  artist?: string;
  album?: string;
}

export interface RawSearchResults {
  query: string;
  tracks: RawTrack[];
  artists: RawArtist[];
  albums: RawAlbum[];
}

export interface HealthResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: string;
}

/** Contract every metadata provider implements (see ARCHITECTURE_PROVIDERS.md). */
export interface MetadataProvider {
  readonly id: string;
  readonly type: 'metadata';

  search(query: string, opts?: SearchOpts): Promise<RawSearchResults>;
  getTrack(id: string): Promise<RawTrack | null>;
  getArtist(id: string): Promise<RawArtist | null>;
  getAlbum(id: string): Promise<RawAlbum | null>;
  getArtistTracks(artistId: string, opts?: PageOpts): Promise<RawTrack[]>;
  getArtistAlbums(artistId: string, opts?: PageOpts): Promise<RawAlbum[]>;
  getAlbumTracks(albumId: string, opts?: PageOpts): Promise<RawTrack[]>;
  getRelatedArtists(artistId: string): Promise<RawArtist[]>;
  healthCheck(): Promise<HealthResult>;
}

/**
 * Contract every playback-source provider implements. Sources are separate
 * from metadata (see ARCHITECTURE_PROVIDERS.md): a track may be described by
 * provider A and streamable from provider B.
 */
export interface SourceProvider {
  readonly id: string;
  readonly type: 'source';

  /** Report what playable/downloadable sources exist for a canonical track. */
  checkAvailability(track: CanonicalTrack): Promise<SourceInfo[]>;

  /**
   * Candidate sources for resolver scoring (ISRC-first, confidence
   * thresholds). Providers return only legally-permitted sources.
   */
  resolveSources(track: CanonicalTrack): Promise<SourceCandidate[]>;
}

export interface CircuitState {
  failures: number;
  open: boolean;
  openedAt: number | null;
  /** Half-open trial requests permitted after the cooldown. */
  halfOpenUntil: number | null;
  totalRequests: number;
  totalFailures: number;
}

export interface ProviderStatus {
  id: string;
  type: ProviderKind;
  enabled: boolean;
  circuit: CircuitState;
}
