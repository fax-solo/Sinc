import { getEnv } from '../config/env.js';
import { AppError } from '@sinc/shared';
import type {
  CanonicalTrack,
  CanonicalAlbum,
  CanonicalArtist,
  CanonicalPlaylist,
} from '@sinc/shared';

interface iTunesTrack {
  wrapperType: string;
  kind: string;
  collectionId: number;
  trackId: number;
  artistId: number;
  artistName: string;
  collectionName: string;
  trackName: string;
  artworkUrl60?: string;
  artworkUrl100?: string;
  artworkUrl512?: string;
  trackNumber?: number;
  trackCount?: number;
  discNumber?: number;
  releaseDate?: string;
  primaryGenreName?: string;
  collectionArtistName?: string;
  trackExplicitness?: string;
  trackTimeMillis?: number;
  country?: string;
}

interface iTunesAlbum {
  wrapperType: string;
  collectionType: string;
  collectionId: number;
  artistName: string;
  artistId: number;
  collectionName: string;
  artworkUrl60?: string;
  artworkUrl100?: string;
  artworkUrl512?: string;
  trackCount?: number;
  releaseDate?: string;
  primaryGenreName?: string;
  collectionExplicitness?: string;
}

interface iTunesArtist {
  wrapperType: string;
  artistType?: string;
  artistName: string;
  artistId: number;
  artistLinkUrl?: string;
  primaryGenreName?: string;
}

interface iTunesResponse<T> {
  resultCount: number;
  results: T[];
}

function artworkUrl(url: string | undefined, size: number): string | undefined {
  if (!url) return undefined;
  return url.replace(/\/60x60bb\.|\/100x100bb\.|\/512x512bb\./, `/${size}x${size}bb.`);
}

function toArtist(ar: {
  artistId: number;
  artistName: string;
  primaryGenreName?: string;
  artworkUrl?: string;
}): CanonicalArtist {
  return {
    id: `itunes:${ar.artistId}`,
    name: ar.artistName,
    providerIds: { itunes: String(ar.artistId) },
    genres: ar.primaryGenreName ? [ar.primaryGenreName] : [],
    artworkUrl: ar.artworkUrl ? artworkUrl(ar.artworkUrl, 300) : undefined,
  };
}

function albumType(name: string): CanonicalAlbum['type'] {
  const lower = (name ?? '').toLowerCase();
  if (lower.includes('single')) return 'single';
  if (lower.includes('ep')) return 'ep';
  if (lower.includes('compilation')) return 'compilation';
  return 'album';
}

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
    title: t.trackName,
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

export class ItunesAdapter {
  private baseUrl: string;

  constructor() {
    this.baseUrl = getEnv().ITUNES_API_URL;
  }

  private async request<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(this.baseUrl);
    url.pathname = path;
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) {
        throw new AppError('ITUNES_ERROR', `iTunes API error: ${res.status}`, 502);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('ITUNES_TIMEOUT', 'iTunes API request failed', 504);
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchTracks(query: string, limit = 25): Promise<CanonicalTrack[]> {
    const data = await this.request<iTunesResponse<iTunesTrack>>('/search', {
      term: query,
      media: 'music',
      entity: 'song',
      limit,
      country: 'US',
    });
    return data.results.map((t) => toTrack(t));
  }

  async searchAlbums(query: string, limit = 25): Promise<CanonicalAlbum[]> {
    const data = await this.request<iTunesResponse<iTunesAlbum>>('/search', {
      term: query,
      media: 'music',
      entity: 'album',
      limit,
      country: 'US',
    });
    return data.results.map((a) => {
      const artist = toArtist({ artistId: a.artistId ?? 0, artistName: a.artistName });
      return {
        id: `itunes:${a.collectionId}`,
        title: a.collectionName,
        artist,
        artworkUrl: artworkUrl(a.artworkUrl100, 300),
        trackCount: a.trackCount ?? 0,
        providerIds: { itunes: String(a.collectionId) },
        releaseDate: a.releaseDate,
        type: albumType(a.collectionName),
      };
    });
  }

  async searchArtists(query: string, limit = 25): Promise<CanonicalArtist[]> {
    const data = await this.request<iTunesResponse<iTunesArtist>>('/search', {
      term: query,
      media: 'music',
      entity: 'musicArtist',
      limit,
      country: 'US',
    });
    const artists = data.results.map((ar) =>
      toArtist({
        artistId: ar.artistId,
        artistName: ar.artistName,
        primaryGenreName: ar.primaryGenreName,
      })
    );

    // The musicArtist search entity returns no artwork. Enrich artists from a
    // single batch lookup, using each artist's latest album artwork as a stand-in.
    const ids = artists
      .filter((a) => Number(a.providerIds.itunes) > 0)
      .map((a) => a.providerIds.itunes);
    if (ids.length > 0) {
      try {
        const lookup = await this.request<iTunesResponse<iTunesAlbum>>('/lookup', {
          id: ids.join(','),
          entity: 'album',
          limit: 1,
          country: 'US',
        });
        const artworkByArtist = new Map<string, string>();
        for (const row of lookup.results) {
          if (row.wrapperType === 'collection' && row.artistId && row.artworkUrl100) {
            if (!artworkByArtist.has(String(row.artistId))) {
              artworkByArtist.set(String(row.artistId), row.artworkUrl100);
            }
          }
        }
        for (const artist of artists) {
          const art = artworkByArtist.get(artist.providerIds.itunes);
          if (art) artist.artworkUrl = artworkUrl(art, 300);
        }
      } catch {
        // Artwork enrichment is best-effort; keep artists without it.
      }
    }

    return artists;
  }

  async searchPlaylists(query: string, limit = 25): Promise<CanonicalPlaylist[]> {
    // The iTunes Search API has no `playlist` entity (returns 400), so we back
    // "playlists" with album results as a demo stand-in.
    const data = await this.request<iTunesResponse<iTunesAlbum>>('/search', {
      term: query,
      media: 'music',
      entity: 'album',
      limit,
      country: 'US',
    });
    return data.results.map((a) => ({
      id: `itunes:${a.collectionId}`,
      name: a.collectionName,
      description: undefined,
      artworkUrl: artworkUrl(a.artworkUrl100, 300),
      owner: { id: `itunes:${a.artistId ?? 0}`, name: a.artistName },
      isCollaborative: false,
      trackCount: a.trackCount ?? 0,
      providerIds: { itunes: String(a.collectionId) },
      createdAt: '',
      updatedAt: '',
    }));
  }

  async lookupTrack(trackId: string): Promise<CanonicalTrack | null> {
    const data = await this.request<iTunesResponse<iTunesTrack>>('/lookup', {
      id: trackId,
      entity: 'song',
      country: 'US',
    });
    const track = data.results.find((r) => r.wrapperType === 'track' && r.kind === 'song');
    return track ? toTrack(track) : null;
  }

  async lookupAlbum(
    albumId: string
  ): Promise<{ album: CanonicalAlbum; tracks: CanonicalTrack[] } | null> {
    const data = await this.request<iTunesResponse<iTunesAlbum | iTunesTrack>>('/lookup', {
      id: albumId,
      entity: 'song',
      country: 'US',
    });

    const albumRow = data.results.find((r): r is iTunesAlbum => r.wrapperType === 'collection');
    if (!albumRow) return null;

    const tracks = data.results
      .filter(
        (r): r is iTunesTrack => r.wrapperType === 'track' && 'kind' in r && r.kind === 'song'
      )
      .sort(
        (a, b) =>
          (a.discNumber ?? 0) - (b.discNumber ?? 0) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0)
      )
      .map((t) => toTrack(t));

    const artist = toArtist({ artistId: albumRow.artistId ?? 0, artistName: albumRow.artistName });
    const album: CanonicalAlbum = {
      id: `itunes:${albumRow.collectionId}`,
      title: albumRow.collectionName,
      artist,
      artworkUrl: artworkUrl(albumRow.artworkUrl100, 300),
      trackCount: albumRow.trackCount ?? tracks.length,
      providerIds: { itunes: String(albumRow.collectionId) },
      releaseDate: albumRow.releaseDate,
      type: albumType(albumRow.collectionName),
    };

    return { album, tracks };
  }

  async lookupArtist(
    artistId: string
  ): Promise<{
    artist: CanonicalArtist;
    albums: CanonicalAlbum[];
    topTracks: CanonicalTrack[];
  } | null> {
    const data = await this.request<iTunesResponse<iTunesArtist | iTunesAlbum | iTunesTrack>>(
      '/lookup',
      {
        id: artistId,
        entity: 'album',
        limit: 200,
        country: 'US',
      }
    );

    const artistRow = data.results.find((r): r is iTunesArtist => r.wrapperType === 'artist');
    if (!artistRow) return null;

    const artist = toArtist({
      artistId: artistRow.artistId,
      artistName: artistRow.artistName,
      primaryGenreName: artistRow.primaryGenreName,
    });

    const albums = data.results
      .filter((r): r is iTunesAlbum => r.wrapperType === 'collection')
      .map((a) => {
        const aArtist = toArtist({ artistId: a.artistId ?? 0, artistName: a.artistName });
        return {
          id: `itunes:${a.collectionId}`,
          title: a.collectionName,
          artist: aArtist,
          artworkUrl: artworkUrl(a.artworkUrl100, 300),
          trackCount: a.trackCount ?? 0,
          providerIds: { itunes: String(a.collectionId) },
          releaseDate: a.releaseDate,
          type: albumType(a.collectionName),
        };
      });

    return { artist, albums, topTracks: [] };
  }
}
