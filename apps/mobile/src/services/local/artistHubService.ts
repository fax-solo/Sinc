/**
 * Unified Artist Hub & Discovery Metadata Service.
 *
 * Orchestrates multi-provider aggregation (Deezer, iTunes, MusicBrainz, Last.fm)
 * and local library integration:
 * - Aggregates verified artist identity and external profile links (including Spotify).
 * - Collects real, verifiable statistics with explicit provider attribution.
 * - Categorizes full discography (Albums, Singles & EPs, Compilations).
 * - Surfaces similar artists and artist-associated playlists (both remote and local library).
 * - Caches aggregated profiles for offline viewing.
 */
import type {
  ArtistDetail,
  ArtistDiscography,
  ArtistStatistics,
  CanonicalAlbum,
  CanonicalArtist,
  CanonicalPlaylist,
  CanonicalTrack,
  ExternalLinks,
} from '@sinc/shared';
import { normalizeText } from '@sinc/shared';
import { deezer, isDeezerId, stripDeezerPrefix } from '../providers/deezer';
import { itunes, stripItunesPrefix } from '../providers/itunes';
import { musicBrainz } from '../providers/musicbrainz';
import { lastFm } from '../providers/lastfm';
import { areSameArtist, deduplicateArtists } from './artistIdentity';
import { storage } from '../../utils/storage';
import { useLibraryStore } from '../library/libraryStore';

const cache = new Map<string, { at: number; data: ArtistDetail }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedDetail(key: string): ArtistDetail | null {
  const mem = cache.get(key);
  if (mem && Date.now() - mem.at < CACHE_TTL_MS) {
    return mem.data;
  }
  const raw = storage.getString(`hub:${key}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { at: number; data: ArtistDetail };
    if (parsed && Date.now() - parsed.at < 24 * 60 * 60 * 1000) {
      cache.set(key, parsed);
      return parsed.data;
    }
  } catch {
    // ignore
  }
  return null;
}

function setCachedDetail(key: string, data: ArtistDetail): void {
  const entry = { at: Date.now(), data };
  cache.set(key, entry);
  try {
    storage.setString(`hub:${key}`, JSON.stringify(entry));
  } catch {
    // ignore
  }
}

export const artistHubService = {
  /**
   * Fetches complete Artist Hub profile.
   */
  async getArtistDetail(
    id: string,
    fallbackName?: string,
    options?: { forceRefresh?: boolean }
  ): Promise<ArtistDetail> {
    const cacheKey = `artist_hub_v2:${id}`;
    if (!options?.forceRefresh) {
      const cached = getCachedDetail(cacheKey);
      if (cached) return cached;
    }

    let deezerId: string | null = isDeezerId(id) ? stripDeezerPrefix(id) : null;
    let itunesId: string | null = id.startsWith('itunes:') ? stripItunesPrefix(id) : null;
    let artistName: string = fallbackName ?? '';

    let baseArtist: CanonicalArtist | null = null;
    let itunesTracks: CanonicalTrack[] = [];
    let itunesAlbums: CanonicalAlbum[] = [];

    // 1. Resolve iTunes baseline if itunes ID
    if (itunesId) {
      try {
        const itunesResult = await itunes.lookupArtist(itunesId);
        if (itunesResult) {
          baseArtist = itunesResult.artist;
          artistName = itunesResult.artist.name;
          itunesTracks = itunesResult.topTracks;
          itunesAlbums = itunesResult.albums;
        }
      } catch {
        // continue
      }
    }

    // 2. If no Deezer ID, try to find Deezer ID by artist name
    if (!deezerId && artistName) {
      try {
        const searchMatches = await deezer.searchArtists(artistName, 5);
        const match = searchMatches.find((cand) =>
          areSameArtist(
            { name: cand.name, providerIds: cand.providerIds, genres: cand.genres },
            { name: artistName, providerIds: baseArtist?.providerIds ?? {}, genres: baseArtist?.genres }
          )
        );
        if (match) {
          deezerId = stripDeezerPrefix(match.id);
        }
      } catch {
        // continue
      }
    }

    // 3. Fetch Deezer detailed data if available
    let deezerDetail: Awaited<ReturnType<typeof deezer.lookupArtistDetailed>> = null;
    if (deezerId) {
      try {
        deezerDetail = await deezer.lookupArtistDetailed(deezerId);
        if (deezerDetail && !artistName) {
          artistName = deezerDetail.artist.name;
        }
      } catch {
        deezerDetail = null;
      }
    }

    const effectiveName = artistName || fallbackName || 'Unknown Artist';

    // 4. Query MusicBrainz in parallel
    const mbPromise = (async () => {
      try {
        const searchMb = await musicBrainz.searchArtist(effectiveName, 3);
        const match = searchMb.find((cand) =>
          areSameArtist(
            { name: cand.name, providerIds: {}, aliases: cand.aliases, genres: cand.genres },
            { name: effectiveName, providerIds: { ...(deezerId ? { deezer: deezerId } : {}) } }
          )
        );
        if (!match) return null;
        return await musicBrainz.lookupArtist(match.id);
      } catch {
        return null;
      }
    })();

    // 5. Query Last.fm in parallel
    const lastFmPromise = lastFm.getArtistInfo(effectiveName).catch(() => null);

    const [mbResult, lastFmResult] = await Promise.all([mbPromise, lastFmPromise]);

    // 6. Build merged CanonicalArtist
    const canonicalArtist: CanonicalArtist = {
      id: deezerDetail ? deezerDetail.artist.id : baseArtist ? baseArtist.id : id,
      name: effectiveName,
      artworkUrl: deezerDetail?.artist.artworkUrl ?? baseArtist?.artworkUrl,
      providerIds: {
        ...(deezerId ? { deezer: deezerId } : {}),
        ...(itunesId ? { itunes: itunesId } : {}),
        ...(mbResult?.id ? { musicbrainz: mbResult.id } : {}),
        ...(baseArtist?.providerIds ?? {}),
      },
      genres: Array.from(
        new Set([
          ...(deezerDetail?.artist.genres ?? []),
          ...(baseArtist?.genres ?? []),
          ...(mbResult?.genres ?? []),
          ...(lastFmResult?.tags ?? []),
        ])
      ).slice(0, 5),
    };

    // 7. External Links (including verified Spotify profile link from MusicBrainz)
    const externalLinks: ExternalLinks = {
      ...(deezerDetail?.link ? { deezer: deezerDetail.link } : {}),
      ...(mbResult?.externalLinks ?? {}),
      ...(lastFmResult?.url ? { lastfm: lastFmResult.url } : {}),
    };

    // 8. Statistics with explicit source providers
    const sourceProviders: string[] = [];
    if (deezerDetail) sourceProviders.push('Deezer');
    if (itunesId || itunesTracks.length > 0) sourceProviders.push('iTunes');
    if (mbResult) sourceProviders.push('MusicBrainz');
    if (lastFmResult) sourceProviders.push('Last.fm');

    const totalAlbumsCount =
      (deezerDetail?.discography.albums.length ?? 0) +
      (deezerDetail?.discography.singles.length ?? 0) +
      (deezerDetail?.discography.eps.length ?? 0) +
      (deezerDetail?.discography.compilations.length ?? 0) ||
      itunesAlbums.length ||
      undefined;

    const statistics: ArtistStatistics = {
      deezerFans: deezerDetail?.fans,
      lastFmListeners: lastFmResult?.listeners,
      lastFmPlayCount: lastFmResult?.playCount,
      albumCount: totalAlbumsCount,
      trackCount: deezerDetail?.topTracks.length || itunesTracks.length || undefined,
      sourceProviders,
    };

    // 9. Categorized Discography
    let discography: ArtistDiscography;
    if (deezerDetail) {
      discography = deezerDetail.discography;
    } else {
      const albums: CanonicalAlbum[] = [];
      const singles: CanonicalAlbum[] = [];
      const eps: CanonicalAlbum[] = [];
      const compilations: CanonicalAlbum[] = [];

      for (const alb of itunesAlbums) {
        if (alb.type === 'single') singles.push(alb);
        else if (alb.type === 'ep') eps.push(alb);
        else if (alb.type === 'compilation') compilations.push(alb);
        else albums.push(alb);
      }

      discography = { albums, singles, eps, compilations };
    }

    // 10. Top Tracks
    const topTracks = (deezerDetail?.topTracks && deezerDetail.topTracks.length > 0)
      ? deezerDetail.topTracks
      : itunesTracks;

    // 11. Similar Artists
    const relatedPool = [
      ...(deezerDetail?.relatedArtists ?? []),
    ];
    const relatedArtists = deduplicateArtists(relatedPool).slice(0, 20);

    // 12. Playlists: combine Deezer artist playlists + user's local playlists containing this artist
    const providerPlaylists = deezerDetail?.playlists ?? [];
    const localPlaylists = useLibraryStore
      .getState()
      .playlists.filter((p) =>
        p.tracks.some(
          (t) =>
            t.artists.some((a) => normalizeText(a.name) === normalizeText(effectiveName)) ||
            (baseArtist?.id && t.artists.some((a) => a.id === baseArtist?.id))
        )
      )
      .map((p): CanonicalPlaylist => ({
        id: `local:${p.id}`,
        name: p.name,
        description: p.description ?? 'In your library',
        artworkUrl: p.coverArtworkUrl ?? p.tracks.find((t) => t.artworkUrl)?.artworkUrl,
        owner: { id: 'local', name: 'Your library' },
        isCollaborative: false,
        trackCount: p.tracks.length,
        providerIds: { local: p.id },
        createdAt: '',
        updatedAt: '',
      }));

    const combinedPlaylists = [...localPlaylists, ...providerPlaylists];

    const result: ArtistDetail = {
      artist: canonicalArtist,
      biography: lastFmResult?.bioSummary || mbResult?.disambiguation,
      country: mbResult?.country,
      lifeSpan: mbResult?.lifeSpan,
      isVerified: Boolean(deezerDetail || mbResult),
      statistics,
      externalLinks,
      topTracks,
      discography,
      relatedArtists,
      playlists: combinedPlaylists,
    };

    setCachedDetail(cacheKey, result);
    return result;
  },
};
