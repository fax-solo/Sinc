/**
 * On-device iTunes Search API client. Mirrors `apps/server/src/lib/itunes.ts`
 * field-for-field so canonical output is identical to the server build
 * (id scheme `itunes:` + `providerIds`, artwork resized to 300, playlists
 * synthesized from album rows, etc).
 */
import type {
  CanonicalAlbum,
  CanonicalArtist,
  CanonicalPlaylist,
  CanonicalTrack,
} from '@sinc/shared';
import { providerFetchJson } from './http';

const BASE_URL = 'https://itunes.apple.com';
const COUNTRY = 'US';

interface iTunesTrack {
  trackId?: number;
  trackName?: string;
  trackTimeMillis?: number;
  trackNumber?: number;
  trackCount?: number;
  artworkUrl100?: string;
  artistId?: number;
  artistName?: string;
  collectionArtistName?: string;
  collectionId?: number;
  collectionName?: string;
  releaseDate?: string;
  wrapperType?: string;
  kind?: string;
  trackExplicitness?: string;
  discNumber?: number;
}

interface iTunesArtistRow {
  artistId?: number;
  artistName?: string;
  primaryGenreName?: string;
  wrapperType?: string;
}

interface iTunesAlbumRow {
  collectionId?: number;
  collectionName?: string;
  collectionType?: string;
  artistId?: number;
  artistName?: string;
  artworkUrl100?: string;
  trackCount?: number;
  releaseDate?: string;
  primaryGenreName?: string;
  wrapperType?: string;
}

function artworkUrl(url: string | undefined, size: number): string | undefined {
  if (!url) return undefined;
  return url.replace(/\/60x60bb\.|\/100x100bb\.|\/512x512bb\./, `/${size}x${size}bb.`);
}

function albumType(name: string | undefined): 'album' | 'single' | 'ep' | 'compilation' {
  const lower = (name ?? '').toLowerCase();
  if (lower.includes('single')) return 'single';
  if (lower.includes('compilation')) return 'compilation';
  if (lower.includes('ep')) return 'ep';
  return 'album';
}

function toArtist(ar: iTunesArtistRow): CanonicalArtist {
  return {
    id: `itunes:${ar.artistId ?? 0}`,
    name: ar.artistName ?? 'Unknown Artist',
    providerIds: { itunes: String(ar.artistId ?? 0) },
    genres: ar.primaryGenreName ? [ar.primaryGenreName] : [],
  };
}

/** Common track mapping used by search + album/artist lookup. */
function toTrack(t: iTunesTrack, preferredArtwork = 300): CanonicalTrack {
  const artist = toArtist({
    artistId: t.artistId ?? 0,
    artistName: t.artistName ?? t.collectionArtistName ?? 'Unknown Artist',
  });
  const album: CanonicalAlbum = {
    id: `itunes:${t.collectionId ?? 0}`,
    title: t.collectionName ?? 'Unknown Album',
    artist,
    artworkUrl: artworkUrl(t.artworkUrl100, preferredArtwork),
    trackCount: t.trackCount ?? 0,
    providerIds: { itunes: String(t.collectionId ?? 0) },
    type: 'album',
  };
  return {
    id: `itunes:${t.trackId}`,
    title: t.trackName ?? 'Unknown Track',
    artists: [artist],
    album,
    durationMs: t.trackTimeMillis ?? 0,
    trackNumber: t.trackNumber,
    artworkUrl: artworkUrl(t.artworkUrl100, preferredArtwork),
    providerIds: { itunes: String(t.trackId) },
    releaseDate: t.releaseDate,
    explicit: t.trackExplicitness === 'explicit',
  };
}

function toAlbum(a: iTunesAlbumRow): CanonicalAlbum {
  return {
    id: `itunes:${a.collectionId}`,
    title: a.collectionName ?? 'Unknown Album',
    artist: toArtist({ artistId: a.artistId, artistName: a.artistName }),
    artworkUrl: artworkUrl(a.artworkUrl100, 300),
    releaseDate: a.releaseDate,
    trackCount: a.trackCount ?? 0,
    providerIds: { itunes: String(a.collectionId) },
    type: albumType(a.collectionName),
  };
}

async function request<T>(path: string): Promise<T> {
  return providerFetchJson<T>(`${BASE_URL}${path}`);
}

function searchPath(term: string, entity: string, limit: number): string {
  return `/search?term=${encodeURIComponent(term)}&media=music&entity=${entity}&limit=${limit}&country=${COUNTRY}`;
}

export const itunes = {
  async searchTracks(query: string, limit = 25): Promise<CanonicalTrack[]> {
    const json = await request<{ results?: iTunesTrack[] }>(searchPath(query, 'song', limit));
    return (json.results ?? []).map((t) => toTrack(t));
  },

  /** Exactly one track by numeric id (server-parity lookup, not a text search). */
  async lookupTrack(trackId: string): Promise<CanonicalTrack | null> {
    const json = await request<{ results?: iTunesTrack[] }>(
      `/lookup?id=${encodeURIComponent(trackId)}&entity=song&limit=1&country=${COUNTRY}`
    );
    const row = (json.results ?? []).find((r) => r.wrapperType === 'track' && r.kind === 'song');
    return row ? toTrack(row) : null;
  },

  async searchAlbums(query: string, limit = 25): Promise<CanonicalAlbum[]> {
    const json = await request<{ results?: iTunesAlbumRow[] }>(searchPath(query, 'album', limit));
    return (json.results ?? []).map(toAlbum);
  },

  async searchArtists(query: string, limit = 25): Promise<CanonicalArtist[]> {
    const json = await request<{ results?: iTunesArtistRow[] }>(
      searchPath(query, 'musicArtist', limit)
    );
    const artists = (json.results ?? []).map((ar) => toArtist(ar));
    if (artists.length === 0) return artists;

    // musicArtist rows carry no artwork, so enrich each with its latest album.
    try {
      const ids = artists.map((a) => a.providerIds.itunes).join(',');
      const lookup = await request<{ results?: iTunesAlbumRow[] }>(
        `/lookup?id=${encodeURIComponent(ids)}&entity=album&limit=1&country=${COUNTRY}`
      );
      const byArtist = new Map<number, string>();
      for (const row of lookup.results ?? []) {
        if (!row.artistId || byArtist.has(row.artistId)) continue;
        const art = artworkUrl(row.artworkUrl100, 300);
        if (art) byArtist.set(row.artistId, art);
      }
      return artists.map((a) => ({
        ...a,
        artworkUrl: byArtist.get(Number(a.providerIds.itunes)),
      }));
    } catch {
      return artists; // enrichment is best-effort
    }
  },

  /** No real iTunes playlist entity exists; synths albums as playlists (server-compatible). */
  async searchPlaylists(query: string, limit = 25): Promise<CanonicalPlaylist[]> {
    const json = await request<{ results?: iTunesAlbumRow[] }>(searchPath(query, 'album', limit));
    return (json.results ?? []).map((a) => ({
      id: `itunes:${a.collectionId}`,
      name: a.collectionName ?? 'Unknown Playlist',
      artworkUrl: artworkUrl(a.artworkUrl100, 300),
      owner: { id: 'itunes', name: 'iTunes' },
      isCollaborative: false,
      trackCount: a.trackCount ?? 0,
      providerIds: { itunes: String(a.collectionId) },
      createdAt: '',
      updatedAt: '',
    }));
  },

  async lookupAlbum(
    albumId: string
  ): Promise<{ album: CanonicalAlbum; tracks: CanonicalTrack[] } | null> {
    const json = await request<{ results?: Array<iTunesAlbumRow & iTunesTrack> }>(
      `/lookup?id=${encodeURIComponent(albumId)}&entity=song&country=${COUNTRY}`
    );
    const rows = json.results ?? [];
    const albumRow = rows.find((r) => r.wrapperType === 'collection');
    if (!albumRow) return null;
    const tracks = rows
      .filter((r) => r.wrapperType === 'track' && r.kind === 'song')
      .sort(
        (a, b) =>
          (a.discNumber ?? 0) - (b.discNumber ?? 0) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0)
      )
      .map((t) => toTrack(t));
    const album: CanonicalAlbum = {
      id: `itunes:${albumRow.collectionId}`,
      title: albumRow.collectionName ?? 'Unknown Album',
      artist: toArtist({ artistId: albumRow.artistId, artistName: albumRow.artistName }),
      artworkUrl: artworkUrl(albumRow.artworkUrl100, 300),
      releaseDate: albumRow.releaseDate,
      trackCount: albumRow.trackCount ?? tracks.length,
      providerIds: { itunes: String(albumRow.collectionId) },
      type: albumType(albumRow.collectionName),
    };
    return { album, tracks };
  },

  async lookupArtist(
    artistId: string
  ): Promise<{
    artist: CanonicalArtist;
    albums: CanonicalAlbum[];
    topTracks: CanonicalTrack[];
  } | null> {
    const json = await request<{ results?: Array<iTunesArtistRow & iTunesAlbumRow> }>(
      `/lookup?id=${encodeURIComponent(artistId)}&entity=album&limit=200&country=${COUNTRY}`
    );
    const rows = json.results ?? [];
    const artistRow = rows.find((r) => r.wrapperType === 'artist');
    if (!artistRow) return null;
    const albums = rows.filter((r) => r.wrapperType === 'collection').map(toAlbum);
    return {
      artist: toArtist(artistRow),
      albums,
      topTracks: [],
    };
  },

  /** Plain artist name lookup used by personalization when mapping genres. */
  async findArtist(query: string): Promise<CanonicalArtist | null> {
    try {
      const results = await this.searchArtists(query, 1);
      return results[0] ?? null;
    } catch {
      return null;
    }
  },
};

export function isItunesId(id: string): boolean {
  return id.startsWith('itunes:');
}

export function stripItunesPrefix(id: string): string {
  return id.startsWith('itunes:') ? id.slice(7) : id;
}
