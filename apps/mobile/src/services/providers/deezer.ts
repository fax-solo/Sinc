/**
 * On-device Deezer API client. Mirrors `apps/server/src/lib/deezer.ts`
 * exactly (no API key needed, `deezer:` ids, `cover_medium ?? cover_big`
 * artwork, duration seconds -> ms).
 */
import type {
  CanonicalAlbum,
  CanonicalArtist,
  CanonicalPlaylist,
  CanonicalTrack,
} from '@sinc/shared';
import { providerFetchJson } from './http';

const BASE_URL = 'https://api.deezer.com';

interface DeezerArtist {
  id?: number;
  name?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  nb_fan?: number;
  nb_album?: number;
  link?: string;
  share?: string;
}

interface DeezerAlbum {
  id?: number;
  title?: string;
  cover_medium?: string;
  cover_big?: string;
  cover_xl?: string;
  release_date?: string;
  nb_tracks?: number;
  record_type?: string;
  fans?: number;
  artist?: DeezerArtist;
}

interface DeezerTrack {
  id?: number;
  title?: string;
  duration?: number;
  release_date?: string;
  explicit_lyrics?: boolean;
  preview?: string;
  artist?: DeezerArtist;
  album?: DeezerAlbum & { release_date?: string };
}

interface DeezerPlaylist {
  id?: number;
  title?: string;
  description?: string;
  picture_medium?: string;
  picture_big?: string;
  nb_tracks?: number;
  creator?: DeezerArtist;
}

interface Paged<T> {
  data: T[];
  total?: number;
}

function toArtist(a: DeezerArtist | undefined): CanonicalArtist {
  if (!a || !a.id) {
    return { id: 'deezer:0', name: 'Unknown Artist', providerIds: { deezer: '0' }, genres: [] };
  }
  return {
    id: `deezer:${a.id}`,
    name: a.name ?? 'Unknown Artist',
    providerIds: { deezer: String(a.id) },
    genres: [],
    artworkUrl: a.picture_medium ?? a.picture_big,
  };
}

function toAlbum(a: DeezerAlbum | undefined): CanonicalAlbum {
  if (!a || !a.id) {
    return {
      id: 'deezer:0',
      title: 'Unknown Album',
      artist: toArtist(a?.artist),
      trackCount: 0,
      providerIds: { deezer: '0' },
      type: 'album',
    };
  }
  let albumType: 'album' | 'single' | 'compilation' | 'ep' = 'album';
  const recType = (a.record_type ?? '').toLowerCase();
  if (recType === 'single') albumType = 'single';
  else if (recType === 'ep') albumType = 'ep';
  else if (recType === 'compile' || recType === 'compilation') albumType = 'compilation';
  return {
    id: `deezer:${a.id}`,
    title: a.title ?? 'Unknown Album',
    artist: toArtist(a.artist),
    artworkUrl: a.cover_medium ?? a.cover_big ?? a.cover_xl,
    releaseDate: a.release_date,
    trackCount: a.nb_tracks ?? 0,
    providerIds: { deezer: String(a.id) },
    type: albumType,
  };
}

function toPlaylist(p: DeezerPlaylist): CanonicalPlaylist {
  return {
    id: `deezer:${p.id}`,
    name: p.title ?? 'Unknown Playlist',
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

/** Server quirk preserved: album trackCount is 0 inside track mapping. */
function toTrack(t: DeezerTrack): CanonicalTrack {
  return {
    id: `deezer:${t.id}`,
    title: t.title ?? 'Unknown Track',
    artists: [toArtist(t.artist)],
    album: {
      id: `deezer:${t.album?.id ?? 0}`,
      title: t.album?.title ?? 'Unknown Album',
      artist: toArtist(t.artist),
      artworkUrl: t.album?.cover_medium ?? t.album?.cover_big,
      releaseDate: t.album?.release_date ?? t.release_date,
      trackCount: 0,
      providerIds: { deezer: String(t.album?.id ?? 0) },
      type: 'album',
    },
    durationMs: (t.duration ?? 0) * 1000,
    artworkUrl: t.album?.cover_medium ?? t.album?.cover_big,
    previewUrl: t.preview,
    providerIds: { deezer: String(t.id) },
    releaseDate: t.release_date,
    explicit: t.explicit_lyrics === true,
  };
}

function clamp(min: number, value: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Deezer reports rate-limit/quota errors inline with HTTP 200
 *  ({error:{type,message,code}}) instead of a failing status. Without this
 *  check every throttled call silently degrades to "empty results", which the
 *  home feed then writes into the on-device cache as an empty shelf. */
class DeezerError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = 'DeezerError';
    this.code = code;
  }
}

interface ErrorPayload {
  error?: { type?: string; message?: string; code?: number };
}

export interface ProviderSearchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  offset?: number;
}

/** Fetch a Deezer collection endpoint, throwing on provider-reported errors. */
async function fetchPaged<T>(
  path: string,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<T[]> {
  const json = await providerFetchJson<Paged<T> & ErrorPayload>(
    `${BASE_URL}${path}`,
    options?.signal ? { signal: options.signal } : undefined,
    options?.timeoutMs
  );
  if (json.error) {
    throw new DeezerError(
      json.error.message ?? `Deezer ${json.error.type ?? 'error'}`,
      json.error.code
    );
  }
  return json.data ?? [];
}

async function fetchDeezerTop(artistId: string): Promise<DeezerTrack[]> {
  return fetchPaged<DeezerTrack>(`/artist/${encodeURIComponent(artistId)}/top?limit=50`);
}

async function fetchDeezerAlbums(artistId: string): Promise<DeezerAlbum[]> {
  return fetchPaged<DeezerAlbum>(`/artist/${encodeURIComponent(artistId)}/albums?limit=25`);
}

export const deezer = {
  async searchTracks(
    query: string,
    limit = 25,
    options?: ProviderSearchOptions
  ): Promise<CanonicalTrack[]> {
    const n = clamp(1, limit, 50);
    const index = options?.offset && options.offset > 0 ? `&index=${options.offset}` : '';
    const tracks = await fetchPaged<DeezerTrack>(
      `/search/track?q=${encodeURIComponent(query)}&limit=${n}${index}`,
      options
    );
    return tracks.map(toTrack);
  },

  async lookupTrack(
    id: string,
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<CanonicalTrack | null> {
    const track = await providerFetchJson<DeezerTrack>(
      `${BASE_URL}/track/${encodeURIComponent(id)}`,
      options?.signal ? { signal: options.signal } : undefined,
      options?.timeoutMs
    );
    if (!track.id && !track.title) return null;
    return toTrack(track);
  },

  async chartTracks(limit = 50): Promise<CanonicalTrack[]> {
    const n = clamp(1, limit, 100);
    const tracks = await fetchPaged<DeezerTrack>(`/chart/0/tracks?limit=${n}`);
    return tracks.map(toTrack);
  },

  async chartAlbums(limit = 25): Promise<CanonicalAlbum[]> {
    const n = clamp(1, limit, 50);
    const albums = await fetchPaged<DeezerAlbum>(`/chart/0/albums?limit=${n}`);
    return albums.map(toAlbum);
  },

  async chartArtists(limit = 25): Promise<CanonicalArtist[]> {
    const n = clamp(1, limit, 50);
    const artists = await fetchPaged<DeezerArtist>(`/chart/0/artists?limit=${n}`);
    return artists.map(toArtist);
  },

  async chartPlaylists(limit = 25): Promise<CanonicalPlaylist[]> {
    const n = clamp(1, limit, 50);
    const playlists = await fetchPaged<DeezerPlaylist>(`/chart/0/playlists?limit=${n}`);
    return playlists.map(toPlaylist);
  },

  async searchPlaylists(
    query: string,
    limit = 25,
    options?: ProviderSearchOptions
  ): Promise<CanonicalPlaylist[]> {
    const n = clamp(1, limit, 50);
    const index = options?.offset && options.offset > 0 ? `&index=${options.offset}` : '';
    const playlists = await fetchPaged<DeezerPlaylist>(
      `/search/playlist?q=${encodeURIComponent(query)}&limit=${n}${index}`,
      options
    );
    return playlists.map(toPlaylist);
  },

  async searchArtists(
    query: string,
    limit = 25,
    options?: ProviderSearchOptions
  ): Promise<CanonicalArtist[]> {
    const n = clamp(1, limit, 50);
    const index = options?.offset && options.offset > 0 ? `&index=${options.offset}` : '';
    const artists = await fetchPaged<DeezerArtist>(
      `/search/artist?q=${encodeURIComponent(query)}&limit=${n}${index}`,
      options
    );
    return artists.map(toArtist);
  },

  async genreArtists(genreId: number, limit = 25): Promise<CanonicalArtist[]> {
    const artists = await fetchPaged<DeezerArtist>(`/genre/${genreId}/artists?limit=${limit}`);
    return artists.map(toArtist);
  },

  async genreChartTracks(genreId: number, limit = 50): Promise<CanonicalTrack[]> {
    const n = clamp(1, limit, 100);
    const tracks = await fetchPaged<DeezerTrack>(`/chart/${genreId}/tracks?limit=${n}`);
    return tracks.map(toTrack);
  },

  /** Best-effort genre id for an artist via their most popular track. */
  async genreForArtist(name: string): Promise<number | null> {
    try {
      const json = await providerFetchJson<
        Paged<DeezerTrack & { genre_id?: number }> & ErrorPayload
      >(`${BASE_URL}/search/track?q=${encodeURIComponent(`artist:"${name}"`)}&limit=1`);
      if (json.error) throw new DeezerError(json.error.message ?? 'Deezer error', json.error.code);
      const track = json.data?.[0];
      return track?.genre_id ?? null;
    } catch {
      return null;
    }
  },

  async searchAlbums(
    query: string,
    limit = 25,
    options?: ProviderSearchOptions
  ): Promise<CanonicalAlbum[]> {
    const n = clamp(1, limit, 50);
    const index = options?.offset && options.offset > 0 ? `&index=${options.offset}` : '';
    const albums = await fetchPaged<DeezerAlbum>(
      `/search/album?q=${encodeURIComponent(query)}&limit=${n}${index}`,
      options
    );
    return albums.map(toAlbum);
  },

  async fetchRelatedArtists(
    artistId: string,
    limit = 25
  ): Promise<CanonicalArtist[]> {
    const n = clamp(1, limit, 50);
    const artists = await fetchPaged<DeezerArtist>(
      `/artist/${encodeURIComponent(artistId)}/related?limit=${n}`
    ).catch(() => []);
    return artists.map(toArtist);
  },

  async fetchArtistPlaylists(
    artistId: string,
    limit = 25
  ): Promise<CanonicalPlaylist[]> {
    const n = clamp(1, limit, 50);
    const playlists = await fetchPaged<DeezerPlaylist>(
      `/artist/${encodeURIComponent(artistId)}/playlists?limit=${n}`
    ).catch(() => []);
    return playlists.map(toPlaylist);
  },

  async lookupArtistDetailed(artistId: string): Promise<{
    artist: CanonicalArtist;
    fans?: number;
    link?: string;
    topTracks: CanonicalTrack[];
    discography: {
      albums: CanonicalAlbum[];
      singles: CanonicalAlbum[];
      eps: CanonicalAlbum[];
      compilations: CanonicalAlbum[];
    };
    relatedArtists: CanonicalArtist[];
    playlists: CanonicalPlaylist[];
  } | null> {
    const [artist, top, albums, related, playlists] = await Promise.all([
      providerFetchJson<DeezerArtist & ErrorPayload>(
        `${BASE_URL}/artist/${encodeURIComponent(artistId)}`
      ).catch(() => null),
      fetchDeezerTop(artistId).catch(() => []),
      fetchDeezerAlbums(artistId).catch(() => []),
      fetchPaged<DeezerArtist>(`/artist/${encodeURIComponent(artistId)}/related?limit=20`).catch(() => []),
      fetchPaged<DeezerPlaylist>(`/artist/${encodeURIComponent(artistId)}/playlists?limit=20`).catch(() => []),
    ]);

    if (!artist || (!artist.id && !artist.name)) return null;

    const canonicalArtist = toArtist(artist);
    const mappedAlbums = albums.map(toAlbum);

    const albumsList: CanonicalAlbum[] = [];
    const singlesList: CanonicalAlbum[] = [];
    const epsList: CanonicalAlbum[] = [];
    const compilationsList: CanonicalAlbum[] = [];

    for (const alb of mappedAlbums) {
      if (alb.type === 'single') singlesList.push(alb);
      else if (alb.type === 'ep') epsList.push(alb);
      else if (alb.type === 'compilation') compilationsList.push(alb);
      else albumsList.push(alb);
    }

    return {
      artist: canonicalArtist,
      fans: typeof artist.nb_fan === 'number' ? artist.nb_fan : undefined,
      link: typeof artist.link === 'string' ? artist.link : undefined,
      topTracks: top.slice(0, 50).map(toTrack),
      discography: {
        albums: albumsList,
        singles: singlesList,
        eps: epsList,
        compilations: compilationsList,
      },
      relatedArtists: related.map(toArtist),
      playlists: playlists.map(toPlaylist),
    };
  },

  async lookupAlbum(
    albumId: string
  ): Promise<{ album: CanonicalAlbum; tracks: CanonicalTrack[] } | null> {
    const json = await providerFetchJson<DeezerAlbum & { tracks?: Paged<DeezerTrack> }>(
      `${BASE_URL}/album/${encodeURIComponent(albumId)}`
    );
    if (!json.id && !json.title) return null;
    const tracks = (json.tracks?.data ?? []).slice(0, 100).map(toTrack);
    return { album: toAlbum(json), tracks };
  },

  async lookupArtist(artistId: string): Promise<{
    artist: CanonicalArtist;
    albums: CanonicalAlbum[];
    topTracks: CanonicalTrack[];
  } | null> {
    const [artist, top, albums] = await Promise.all([
      providerFetchJson<DeezerArtist & ErrorPayload>(
        `${BASE_URL}/artist/${encodeURIComponent(artistId)}`
      ),
      fetchDeezerTop(artistId),
      fetchDeezerAlbums(artistId),
    ]);
    if (!artist.id && !artist.name) return null;
    return {
      artist: toArtist(artist),
      topTracks: top.slice(0, 20).map(toTrack),
      albums: albums.slice(0, 25).map(toAlbum),
    };
  },

  async lookupPlaylist(
    playlistId: string
  ): Promise<{ playlist: CanonicalPlaylist; tracks: CanonicalTrack[] } | null> {
    const json = await providerFetchJson<DeezerPlaylist & { tracks?: Paged<DeezerTrack> }>(
      `${BASE_URL}/playlist/${encodeURIComponent(playlistId)}`
    );
    if (!json.id && !json.title) return null;
    const tracks = (json.tracks?.data ?? []).slice(0, 100).map(toTrack);
    return { playlist: toPlaylist(json), tracks };
  },
};

export function isDeezerId(id: string): boolean {
  return id.startsWith('deezer:');
}

export function stripDeezerPrefix(id: string): string {
  return id.startsWith('deezer:') ? id.slice(7) : id;
}
