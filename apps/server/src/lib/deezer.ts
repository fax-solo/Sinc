import { AppError } from '@sinc/shared';
import type {
  CanonicalTrack,
  CanonicalAlbum,
  CanonicalArtist,
  CanonicalPlaylist,
} from '@sinc/shared';

/**
 * Deezer public API adapter. No API key required (rate limited). Deezer has
 * strong Arabic/MENA coverage, which the iTunes Search API frequently misses,
 * so it backs the search endpoint for non-Latin queries. Also backs the
 * global charts (Top 50, new releases, top playlists/artists) and the genre
 * charts used to build the user's Daily Mixes.
 */

interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  release_date?: string;
  explicit_lyrics?: boolean;
  genre_id?: number;
  artist?: { id: number; name: string; picture_medium?: string; picture_big?: string };
  album?: {
    id: number;
    title: string;
    cover_medium?: string;
    cover_big?: string;
    release_date?: string;
  };
}

interface DeezerSearchResponse {
  data?: DeezerTrack[];
  error?: { message?: string; code?: number };
}

interface DeezerTrackResponse extends DeezerTrack {
  error?: { message?: string; code?: number };
}

interface DeezerArtist {
  id: number;
  name: string;
  picture_medium?: string;
  picture_big?: string;
}

interface DeezerAlbum {
  id: number;
  title: string;
  cover_medium?: string;
  cover_big?: string;
  release_date?: string;
  nb_tracks?: number;
  artist?: DeezerArtist;
  tracks?: { data?: DeezerTrack[] };
}

interface DeezerPlaylist {
  id: number;
  title: string;
  description?: string;
  picture_medium?: string;
  picture_big?: string;
  nb_tracks?: number;
  creator?: { id: number; name: string };
  tracks?: { data?: DeezerTrack[] };
}

interface DeezerChartAlbums {
  data?: DeezerAlbum[];
  error?: { message?: string; code?: number };
}

interface DeezerChartArtists {
  data?: DeezerArtist[];
  error?: { message?: string; code?: number };
}

interface DeezerChartPlaylists {
  data?: DeezerPlaylist[];
  error?: { message?: string; code?: number };
}

interface DeezerPlaylistResponse extends DeezerPlaylist {
  error?: { message?: string; code?: number };
}

interface DeezerGenreResponse {
  id?: number;
  name?: string;
  error?: { message?: string; code?: number };
}

interface DeezerAlbumResponse extends DeezerAlbum {
  error?: { message?: string; code?: number };
}

interface DeezerArtistResponse extends DeezerArtist {
  error?: { message?: string; code?: number };
}

function toArtist(artist: DeezerArtist): CanonicalArtist {
  return {
    id: `deezer:${artist.id}`,
    name: artist.name,
    providerIds: { deezer: String(artist.id) },
    genres: [],
    artworkUrl: artist.picture_medium ?? artist.picture_big,
  };
}

function toAlbum(a: DeezerAlbum): CanonicalAlbum {
  const artist = a.artist ? toArtist(a.artist) : toArtist({ id: 0, name: 'Unknown Artist' });
  return {
    id: `deezer:${a.id}`,
    title: a.title,
    artist,
    artworkUrl: a.cover_medium ?? a.cover_big,
    releaseDate: a.release_date,
    trackCount: a.nb_tracks ?? 0,
    providerIds: { deezer: String(a.id) },
    type: 'album',
  };
}

function toPlaylist(p: DeezerPlaylist): CanonicalPlaylist {
  return {
    id: `deezer:${p.id}`,
    name: p.title,
    description: p.description,
    artworkUrl: p.picture_medium ?? p.picture_big,
    owner: { id: `deezer:${p.creator?.id ?? 0}`, name: p.creator?.name ?? 'Deezer' },
    isCollaborative: false,
    trackCount: p.nb_tracks ?? 0,
    providerIds: { deezer: String(p.id) },
    createdAt: '',
    updatedAt: '',
  };
}

function toTrack(t: DeezerTrack): CanonicalTrack {
  const artist = t.artist ? toArtist(t.artist) : toArtist({ id: 0, name: 'Unknown Artist' });

  const album: CanonicalAlbum = {
    id: `deezer:${t.album?.id ?? 0}`,
    title: t.album?.title ?? 'Unknown Album',
    artist,
    artworkUrl: t.album?.cover_medium ?? t.album?.cover_big,
    trackCount: 0,
    providerIds: { deezer: String(t.album?.id ?? 0) },
    releaseDate: t.album?.release_date ?? t.release_date,
    type: 'album',
  };

  return {
    id: `deezer:${t.id}`,
    title: t.title,
    artists: [artist],
    album,
    durationMs: (t.duration ?? 0) * 1000,
    artworkUrl: t.album?.cover_medium ?? t.album?.cover_big,
    providerIds: { deezer: String(t.id) },
    releaseDate: t.release_date,
    explicit: t.explicit_lyrics === true,
  };
}

export class DeezerAdapter {
  private baseUrl = 'https://api.deezer.com';

  private async request<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) {
        throw new AppError('DEEZER_ERROR', `Deezer API error: ${res.status}`, 502);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('DEEZER_TIMEOUT', 'Deezer API request failed', 504);
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchTracks(query: string, limit = 25): Promise<CanonicalTrack[]> {
    const data = await this.request<DeezerSearchResponse>('/search/track', {
      q: query,
      limit: Math.min(limit, 50),
    });
    if (data.error || !Array.isArray(data.data)) return [];
    return data.data.map((t) => toTrack(t));
  }

  async lookupTrack(trackId: string): Promise<CanonicalTrack | null> {
    const data = await this.request<DeezerTrackResponse>(`/track/${encodeURIComponent(trackId)}`);
    if (data.error || !data.id) return null;
    return toTrack(data);
  }

  /** Global Top 50 songs, in chart order. */
  async chartTracks(limit = 50): Promise<CanonicalTrack[]> {
    const data = await this.request<DeezerSearchResponse>('/chart/0/tracks', {
      limit: Math.min(limit, 100),
    });
    if (data.error || !Array.isArray(data.data)) return [];
    return data.data.map((t) => toTrack(t));
  }

  /** Top albums — backs the "New Releases" rail. */
  async chartAlbums(limit = 25): Promise<CanonicalAlbum[]> {
    const data = await this.request<DeezerChartAlbums>('/chart/0/albums', {
      limit: Math.min(limit, 50),
    });
    if (data.error || !Array.isArray(data.data)) return [];
    return data.data.map((a) => toAlbum(a));
  }

  /** Top artists rail. */
  async chartArtists(limit = 10): Promise<CanonicalArtist[]> {
    const data = await this.request<DeezerChartArtists>('/chart/0/artists', {
      limit: Math.min(limit, 50),
    });
    if (data.error || !Array.isArray(data.data)) return [];
    return data.data.map((a) => toArtist(a));
  }

  /** Top playlists rail — real editorial playlists (not albums). */
  async chartPlaylists(limit = 10): Promise<CanonicalPlaylist[]> {
    const data = await this.request<DeezerChartPlaylists>('/chart/0/playlists', {
      limit: Math.min(limit, 50),
    });
    if (data.error || !Array.isArray(data.data)) return [];
    return data.data.map((p) => toPlaylist(p));
  }

  /** A playlist and its tracks (used when a top playlist is opened). */
  async lookupPlaylist(
    playlistId: string
  ): Promise<{ playlist: CanonicalPlaylist; tracks: CanonicalTrack[] } | null> {
    const data = await this.request<DeezerPlaylistResponse>(
      `/playlist/${encodeURIComponent(playlistId)}`
    );
    if (data.error || !data.id) return null;
    const tracks = (data.tracks?.data ?? []).slice(0, 100).map((t) => toTrack(t));
    return { playlist: toPlaylist(data), tracks };
  }

  /** An album and its tracks (used when a chart album is opened). */
  async lookupAlbum(
    albumId: string
  ): Promise<{ album: CanonicalAlbum; tracks: CanonicalTrack[] } | null> {
    const data = await this.request<DeezerAlbumResponse>(`/album/${encodeURIComponent(albumId)}`);
    if (data.error || !data.id) return null;
    const tracks = (data.tracks?.data ?? []).slice(0, 100).map((t) => toTrack(t));
    return { album: toAlbum(data), tracks };
  }

  /** An artist, their top tracks and albums (used when a chart artist is opened). */
  async lookupArtist(
    artistId: string
  ): Promise<{
    artist: CanonicalArtist;
    albums: CanonicalAlbum[];
    topTracks: CanonicalTrack[];
  } | null> {
    const data = await this.request<DeezerArtistResponse>(
      `/artist/${encodeURIComponent(artistId)}`
    );
    if (data.error || !data.id) return null;

    const [topData, albumData] = await Promise.all([
      this.request<DeezerSearchResponse>(`/artist/${encodeURIComponent(artistId)}/top`, {
        limit: 50,
      }),
      this.request<DeezerChartAlbums>(`/artist/${encodeURIComponent(artistId)}/albums`, {
        limit: 25,
      }),
    ]);

    const topTracks = (topData.data ?? []).slice(0, 20).map((t) => toTrack(t));
    const albums = (albumData.data ?? []).slice(0, 25).map((a) => toAlbum(a));
    return { artist: toArtist(data), albums, topTracks };
  }

  /** Playlist search — backs playlist recommendations ("more like X"). */
  async searchPlaylists(query: string, limit = 10): Promise<CanonicalPlaylist[]> {
    const data = await this.request<DeezerChartPlaylists>('/search/playlist', {
      q: query,
      limit: Math.min(limit, 50),
    });
    if (data.error || !Array.isArray(data.data)) return [];
    return data.data.map((p) => toPlaylist(p));
  }

  /** Artist search — backs artist mixes and "artists you might like" seeds. */
  async searchArtists(query: string, limit = 10): Promise<CanonicalArtist[]> {
    const data = await this.request<DeezerChartArtists>('/search/artist', {
      q: query,
      limit: Math.min(limit, 50),
    });
    if (data.error || !Array.isArray(data.data)) return [];
    return data.data.map((a) => toArtist(a));
  }

  /** Top artists for a genre id — the seed pool for artist recommendations. */
  async genreArtists(genreId: number, limit = 10): Promise<CanonicalArtist[]> {
    const data = await this.request<DeezerChartArtists>(`/genre/${genreId}/artists`, {
      limit: Math.min(limit, 50),
    });
    if (data.error || !Array.isArray(data.data)) return [];
    return data.data.map((a) => toArtist(a));
  }

  /** Top tracks for a genre id — the seed pool for a Daily Mix. */
  async genreChartTracks(genreId: number, limit = 50): Promise<CanonicalTrack[]> {
    const data = await this.request<DeezerSearchResponse>(`/chart/${genreId}/tracks`, {
      limit: Math.min(limit, 100),
    });
    if (data.error || !Array.isArray(data.data)) return [];
    return data.data.map((t) => toTrack(t));
  }

  /** The Deezer genre id of the top hit for an artist name, or null. */
  async genreForArtist(artistName: string): Promise<number | null> {
    if (!artistName.trim()) return null;
    const data = await this.request<DeezerSearchResponse>('/search/track', {
      q: `artist:"${artistName}"`,
      limit: 1,
    });
    const genreId = data.data?.[0]?.genre_id;
    return typeof genreId === 'number' ? genreId : null;
  }

  /** The display name for a Deezer genre id, or null. */
  async genreName(genreId: number): Promise<string | null> {
    const data = await this.request<DeezerGenreResponse>(`/genre/${genreId}`);
    if (data.error || !data.name) return null;
    return data.name;
  }

  private genreCatalogCache: { at: number; data: { id: number; name: string }[] } | null = null;

  /** The full top-level genre catalog (id + name), cached for 24h. */
  async listGenres(): Promise<{ id: number; name: string }[]> {
    if (this.genreCatalogCache && Date.now() - this.genreCatalogCache.at < 24 * 3600 * 1000) {
      return this.genreCatalogCache.data;
    }
    const data = await this.request<{ data?: DeezerGenreResponse[]; error?: { message?: string } }>(
      '/genre'
    );
    const catalog = (data.data ?? [])
      .filter((g): g is DeezerGenreResponse => typeof g.id === 'number')
      .map((g) => ({ id: g.id as number, name: g.name ?? '' }));
    this.genreCatalogCache = { at: Date.now(), data: catalog };
    return catalog;
  }

  /** Maps a provider genre name (e.g. iTunes "Hip-Hop/Rap") to a Deezer genre id, or null. */
  async genreIdForName(name: string): Promise<number | null> {
    if (!name.trim()) return null;
    const catalog = await this.listGenres();
    const tokens = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    const nameTokens = tokens(name);
    if (nameTokens.length === 0) return null;
    const normalized = nameTokens.join('');

    let best: { id: number; score: number } | null = null;
    for (const genre of catalog) {
      const genreTokens = tokens(genre.name);
      if (genreTokens.length === 0) continue;
      if (genreTokens.join('') === normalized) return genre.id;
      const score = genreTokens.filter((t) => nameTokens.includes(t)).length;
      if (score > 0 && (!best || score > best.score)) best = { id: genre.id, score };
    }
    return best?.id ?? null;
  }
}
