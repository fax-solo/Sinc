import { apiClient } from './client';
import { config } from '../app/config';
import type {
  CanonicalAlbum,
  CanonicalArtist,
  CanonicalPlaylist,
  CanonicalTrack,
  TrackLyrics,
} from '@sinc/shared';

export interface SearchResults {
  tracks?: { data: Array<{ track: CanonicalTrack; score: number }>; meta: unknown };
  artists?: { data: CanonicalArtist[]; meta: unknown };
  albums?: { data: CanonicalAlbum[]; meta: unknown };
  playlists?: { data: CanonicalPlaylist[]; meta: unknown };
}

export type SearchType = 'all' | 'tracks' | 'artists' | 'albums' | 'playlists';

export interface PlaybackSource {
  uri: string;
  mimeType: string;
  quality: string;
  provider: string;
  expiresIn: number;
}

export interface HomeFeed {
  popularTracks: CanonicalTrack[];
  newAlbums: CanonicalAlbum[];
  topPlaylists: CanonicalPlaylist[];
  topArtists: CanonicalArtist[];
  starterMixes: DailyMix[];
}

export type MixKind = 'daily' | 'favorites' | 'discovery' | 'artist' | 'mood';

export interface DailyMix {
  id: string;
  name: string;
  kind: MixKind;
  genre: string;
  description?: string;
  artworkUrl?: string;
  trackCount: number;
  tracks: CanonicalTrack[];
}

export type HomeSection =
  | { kind: 'quick-access'; title: string; playlists: CanonicalPlaylist[] }
  | { kind: 'recently-played'; title: string; tracks: CanonicalTrack[] }
  | { kind: 'mixes'; title: string; mixes: DailyMix[] }
  | { kind: 'tracks'; title: string; explanation?: string; tracks: CanonicalTrack[] }
  | { kind: 'albums'; title: string; explanation?: string; albums: CanonicalAlbum[] }
  | { kind: 'artists'; title: string; explanation?: string; artists: CanonicalArtist[] }
  | { kind: 'playlists'; title: string; explanation?: string; playlists: CanonicalPlaylist[] };

export interface PersonalizedHomeFeed {
  sections: HomeSection[];
  personalized: boolean;
}

/** Local-library summary sent with the personalized feed request. */
export interface LibraryPayload {
  playlists: Array<{
    id: string;
    name: string;
    artworkUrl?: string;
    trackCount: number;
    updatedAt: number;
  }>;
  recentlyPlayedPlaylistIds: string[];
  downloadedTracks: CanonicalTrack[];
  followedArtists: CanonicalArtist[];
  followedAlbums: CanonicalAlbum[];
}

export interface DownloadJob {
  id: string;
  trackId: string;
  trackTitle: string;
  trackArtist: string;
  trackArtwork?: string | null;
  quality: string;
  status: string;
  progress: number;
  bytesDownloaded: number;
  bytesTotal?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  provider?: string | null;
  sourceUrl?: string | null;
  localPath?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export const musicApi = {
  getHomeFeed(): Promise<HomeFeed> {
    return apiClient.get<HomeFeed>('/music/home');
  },

  getPersonalizedHomeFeed(library: LibraryPayload): Promise<PersonalizedHomeFeed> {
    return apiClient.post<PersonalizedHomeFeed>('/music/home/personalized', { library });
  },

  recordPlay(track: CanonicalTrack): Promise<{ ok: boolean }> {
    return apiClient.post<{ ok: boolean }>('/music/history', {
      trackId: track.id,
      trackTitle: track.title,
      trackArtist: track.artists[0]?.name,
      trackAlbum: track.album?.title,
      trackArtwork: track.artworkUrl,
      durationMs: track.durationMs,
    });
  },

  recordCollectionPlay(item: {
    id: string;
    type: 'mix' | 'album' | 'playlist';
    title: string;
    subtitle?: string;
    artworkUrl?: string;
  }): Promise<{ ok: boolean }> {
    return apiClient.post<{ ok: boolean }>('/music/history/collections', {
      itemId: item.id,
      itemType: item.type,
      title: item.title,
      subtitle: item.subtitle,
      artworkUrl: item.artworkUrl,
    });
  },

  syncFavorites(tracks: CanonicalTrack[]): Promise<{ ok: boolean }> {
    return apiClient.put<{ ok: boolean }>('/music/favorites', {
      tracks: tracks.map((t) => ({
        trackId: t.id,
        trackTitle: t.title,
        trackSubtitle: t.artists[0]?.name,
      })),
    });
  },

  search(query: string, type: SearchType = 'all', signal?: AbortSignal): Promise<SearchResults> {
    return apiClient.get<SearchResults>(
      `/music/search?q=${encodeURIComponent(query)}&type=${type}&limit=25`,
      undefined,
      signal
    );
  },

  getTrack(id: string): Promise<{ track: CanonicalTrack; sources: PlaybackSource[] }> {
    return apiClient.get<{ track: CanonicalTrack; sources: PlaybackSource[] }>(
      `/music/tracks/${encodeURIComponent(id)}`
    );
  },

  resolvePlayback(id: string): Promise<PlaybackSource> {
    return apiClient.get<PlaybackSource>(`/music/tracks/${encodeURIComponent(id)}/play`);
  },

  getAlbum(id: string): Promise<{ album: CanonicalAlbum; tracks: CanonicalTrack[] }> {
    return apiClient.get<{ album: CanonicalAlbum; tracks: CanonicalTrack[] }>(
      `/music/albums/${encodeURIComponent(id)}`
    );
  },

  getArtist(
    id: string
  ): Promise<{ artist: CanonicalArtist; albums: CanonicalAlbum[]; topTracks: CanonicalTrack[] }> {
    return apiClient.get<{
      artist: CanonicalArtist;
      albums: CanonicalAlbum[];
      topTracks: CanonicalTrack[];
    }>(`/music/artists/${encodeURIComponent(id)}`);
  },

  getPlaylist(id: string): Promise<{ playlist: CanonicalPlaylist; tracks: CanonicalTrack[] }> {
    return apiClient.get<{ playlist: CanonicalPlaylist; tracks: CanonicalTrack[] }>(
      `/music/playlists/${encodeURIComponent(id)}`
    );
  },

  startDownload(id: string, track: CanonicalTrack): Promise<DownloadJob> {
    return apiClient.post<DownloadJob>(`/music/tracks/${encodeURIComponent(id)}/download`, {
      track,
    });
  },

  listDownloads(): Promise<DownloadJob[]> {
    return apiClient.get<DownloadJob[]>('/music/downloads');
  },

  getDownload(jobId: string): Promise<DownloadJob> {
    return apiClient.get<DownloadJob>(`/music/downloads/${encodeURIComponent(jobId)}`);
  },

  deleteDownload(jobId: string): Promise<void> {
    return apiClient.delete<void>(`/music/downloads/${encodeURIComponent(jobId)}`);
  },

  downloadFileUrl(jobId: string): string {
    return `${config.apiBaseUrl}/music/downloads/${encodeURIComponent(jobId)}/file`;
  },

  getLyrics(id: string, track: CanonicalTrack): Promise<TrackLyrics> {
    return apiClient.post<TrackLyrics>(`/music/tracks/${encodeURIComponent(id)}/lyrics`, {
      track,
    });
  },
};

export interface SpotifyImportPlaylist {
  id: string;
  name: string;
  owner: string;
  artworkUrl: string | null;
  totalCount: number;
  truncated: boolean;
}

export interface SpotifyImportResult {
  playlist: SpotifyImportPlaylist;
  tracks: CanonicalTrack[];
  counts: {
    fetched: number;
    matched: number;
    unresolved: number;
    duplicates: number;
  };
}

export async function importSpotifyPlaylist(url: string): Promise<SpotifyImportResult> {
  return apiClient.post<SpotifyImportResult>('/music/import/spotify', { url });
}
