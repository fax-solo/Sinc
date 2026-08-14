import type {
  CanonicalAlbum,
  CanonicalArtist,
  CanonicalTrack,
  PlaybackResolveResult,
  SourceInfo,
} from '@sinc/shared';
import { apiClient } from './client';

export type SearchType = 'all' | 'songs' | 'artists' | 'albums' | 'playlists';

export interface SearchGroupMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

export interface ScoredTrack {
  track: CanonicalTrack;
  score: number;
}

export interface SearchResponse {
  tracks: { data: ScoredTrack[]; meta: SearchGroupMeta };
  artists: { data: CanonicalArtist[]; meta: SearchGroupMeta };
  albums: { data: CanonicalAlbum[]; meta: SearchGroupMeta };
  playlists: { data: unknown[]; meta: SearchGroupMeta };
}

export interface SearchSuggestion {
  type: 'song' | 'artist' | 'album';
  id: string;
  text: string;
  subtitle?: string;
  artworkUrl?: string;
}

export interface SearchParams {
  q: string;
  type?: Exclude<SearchType, 'all'>;
  artist?: string;
  album?: string;
  durationMin?: number;
  durationMax?: number;
  page?: number;
  limit?: number;
}

export interface ProviderSummary {
  attempted: string[];
  succeeded: string[];
  failed: Array<{ provider: string; error: string }>;
}

export interface TrackDetailResponse {
  track: CanonicalTrack;
  providers: ProviderSummary;
}

export interface ArtistDetailResponse {
  artist: CanonicalArtist;
  topTracks: CanonicalTrack[];
  albums: CanonicalAlbum[];
  relatedArtists: CanonicalArtist[];
  providers: ProviderSummary;
}

export interface AlbumDetailResponse {
  album: CanonicalAlbum;
  tracks: CanonicalTrack[];
  providers: ProviderSummary;
}

export interface TrackSourcesResponse {
  track: CanonicalTrack;
  sources: SourceInfo[];
  providers: ProviderSummary;
}

export interface DetailQueryOptions {
  provider?: string;
  limit?: number;
  offset?: number;
}

/** First provider id available on an entity (provider-qualified detail ids). */
export function providerIdOf(providerIds: Record<string, string> | undefined): string | undefined {
  return providerIds ? Object.values(providerIds)[0] : undefined;
}

function toQueryString(params: object): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export const musicApi = {
  async search(params: SearchParams): Promise<SearchResponse> {
    return apiClient.request<SearchResponse>(
      `/music/search${toQueryString({
        q: params.q,
        type: params.type,
        artist: params.artist,
        album: params.album,
        durationMin: params.durationMin,
        durationMax: params.durationMax,
        page: params.page,
        limit: params.limit,
      })}`,
    );
  },

  async suggest(q: string, limit = 8): Promise<SearchSuggestion[]> {
    const response = await apiClient.request<{ suggestions: SearchSuggestion[] }>(
      `/music/search/suggest${toQueryString({ q, limit })}`,
    );
    return response.suggestions;
  },

  async getTrackDetail(id: string, opts: DetailQueryOptions = {}): Promise<TrackDetailResponse> {
    return apiClient.request<TrackDetailResponse>(
      `/music/tracks/${encodeURIComponent(id)}${toQueryString(opts)}`,
    );
  },

  async getArtistDetail(id: string, opts: DetailQueryOptions = {}): Promise<ArtistDetailResponse> {
    return apiClient.request<ArtistDetailResponse>(
      `/music/artists/${encodeURIComponent(id)}${toQueryString(opts)}`,
    );
  },

  async getAlbumDetail(id: string, opts: DetailQueryOptions = {}): Promise<AlbumDetailResponse> {
    return apiClient.request<AlbumDetailResponse>(
      `/music/albums/${encodeURIComponent(id)}${toQueryString(opts)}`,
    );
  },

  /** Backend intentionally 404s until M3.2; kept for the playlist screen. */
  async getPlaylistDetail(id: string, opts: DetailQueryOptions = {}): Promise<unknown> {
    return apiClient.request<unknown>(
      `/music/playlists/${encodeURIComponent(id)}${toQueryString(opts)}`,
    );
  },

  async getTrackSources(id: string, provider?: string): Promise<TrackSourcesResponse> {
    return apiClient.request<TrackSourcesResponse>(
      `/music/tracks/${encodeURIComponent(id)}/sources${toQueryString({ provider })}`,
    );
  },

  /** Resolve a track to one playable, signed stream URL (M2.6 backend). */
  async resolvePlayback(
    trackId: string,
    opts: DetailQueryOptions = {},
  ): Promise<PlaybackResolveResult> {
    return apiClient.request<PlaybackResolveResult>(
      `/playback/tracks/${encodeURIComponent(trackId)}/resolve${toQueryString(opts)}`,
    );
  },
};
