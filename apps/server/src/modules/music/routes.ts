import type { FastifyInstance } from 'fastify';
import type {
  CanonicalAlbum,
  CanonicalArtist,
  CanonicalPlaylist,
  CanonicalTrack,
} from '@sinc/shared';
import { AppError, NotFoundError, ValidationError } from '@sinc/shared';
import { Readable } from 'node:stream';
import type { ItunesAdapter } from '../../lib/itunes.js';
import type { DeezerAdapter } from '../../lib/deezer.js';
import type { YtdlpResolver } from '../../lib/ytdlp.js';
import { decodeTrackId, isYtdlpId } from '../../lib/ytdlp.js';
import { searchKey, type SearchCache } from '../../lib/search-cache.js';
import { normalizeText, pickBestMatch } from '../../lib/track-match.js';
import { parsePlaylistId, fetchPlaylistTracks, type SpotifyRawTrack } from '../../lib/spotify.js';
import { adminGuard, authGuard, type AuthenticatedRequest } from '../../plugins/guard.js';
import { prisma } from '../../lib/prisma.js';
import type { TokenService } from '../auth/tokens.js';
import type {
  PersonalizationService,
  DailyMix,
  LibraryPayload,
  LibrarySignals,
} from './personalization.js';
import { parseLibraryPayload } from './personalization.js';
import type { MusicSignalService } from './signals.js';

type SearchType = 'all' | 'tracks' | 'artists' | 'albums' | 'playlists';

/**
 * Mirrors a user's on-device playlists (sent with the personalized feed) into
 * the Playlist table so admin tooling can see them. The library payload is the
 * authoritative full snapshot of the user's local playlists, so missing ones
 * are pruned. IDs are namespaced by user to keep them collision-free. Never
 * throws; sync failures must not break feed generation.
 */
export async function syncUserPlaylists(userId: string, library: LibraryPayload): Promise<void> {
  const playlists = library.playlists ?? [];
  if (playlists.length === 0) {
    await prisma.playlist.deleteMany({ where: { userId } });
    return;
  }
  const seen = new Set<string>();
  await Promise.all(
    playlists.map((p) => {
      const id = `${userId}::${p.id}`;
      seen.add(id);
      const stamped = p.updatedAt > 0 ? new Date(p.updatedAt) : new Date();
      return prisma.playlist.upsert({
        where: { id },
        create: {
          id,
          userId,
          name: p.name,
          artworkUrl: p.artworkUrl ?? null,
          trackCount: p.trackCount,
          createdAt: stamped,
        },
        update: {
          name: p.name,
          artworkUrl: p.artworkUrl ?? null,
          trackCount: p.trackCount,
          updatedAt: stamped,
        },
      });
    })
  );
  if (seen.size > 0) {
    await prisma.playlist.deleteMany({ where: { userId, id: { notIn: [...seen] } } });
  }
}

interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

interface ResolvedStreamData {
  uri: string;
  provider: string;
  mimeType: string;
}

function meta(page: number, limit: number, total = 0): Paginated<unknown>['meta'] {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

function score(query: string, track: CanonicalTrack): number {
  const q = query.toLowerCase();
  const title = track.title.toLowerCase();
  let s = 0;
  if (title === q) s += 100;
  else if (title.startsWith(q)) s += 80;
  else if (title.includes(q)) s += 60;
  if (track.artists.some((a) => a.name.toLowerCase().includes(q))) s += 40;
  return s;
}

function isNonLatin(query: string): boolean {
  return /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Greek}\p{Script=Cyrillic}]/u.test(
    query
  );
}

/** Coalesces concurrent requests for the same cache key into a single upstream
 *  fetch (single-flight), so duplicate search keystrokes never fan out to the
 *  catalog APIs. */
const inFlight = new Map<string, Promise<unknown>>();
function singleFlight<T>(key: string, task: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const promise = task().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

interface SearchPool {
  tracks: Array<{ track: CanonicalTrack; score: number }>;
  artists: CanonicalArtist[];
  albums: CanonicalAlbum[];
  playlists: CanonicalPlaylist[];
}

/** Fetches a search pool (one provider call per type) with each provider
 *  isolated so a single upstream failure degrades that type instead of
 *  failing the whole search. Tracks are sorted by relevance. */
async function buildSearchPool(
  query: string,
  type: SearchType,
  itunes: ItunesAdapter,
  deezer: DeezerAdapter,
  fetchLimit: number
): Promise<SearchPool> {
  const needTracks = type === 'all' || type === 'tracks';
  const [itunesTracks, deezerTracks, itunesArtists, itunesAlbums, itunesPlaylists] =
    await Promise.all([
      needTracks
        ? itunes.searchTracks(query, fetchLimit).catch(() => [] as CanonicalTrack[])
        : Promise.resolve([]),
      needTracks
        ? deezer.searchTracks(query, fetchLimit).catch(() => [] as CanonicalTrack[])
        : Promise.resolve([]),
      type === 'all' || type === 'artists'
        ? itunes.searchArtists(query, fetchLimit).catch(() => [] as CanonicalArtist[])
        : Promise.resolve([]),
      type === 'all' || type === 'albums'
        ? itunes.searchAlbums(query, fetchLimit).catch(() => [] as CanonicalAlbum[])
        : Promise.resolve([]),
      type === 'all' || type === 'playlists'
        ? itunes.searchPlaylists(query, fetchLimit).catch(() => [] as CanonicalPlaylist[])
        : Promise.resolve([]),
    ]);
  // iTunes frequently returns unrelated popular tracks for non-Latin queries
  // (its search API does not index Arabic well), so Deezer's results take
  // precedence there.
  const merged = isNonLatin(query)
    ? mergeTrackResults(deezerTracks, itunesTracks)
    : mergeTrackResults(itunesTracks, deezerTracks);
  return {
    tracks: merged
      .map((track) => ({ track, score: score(query, track) }))
      .sort((a, b) => b.score - a.score),
    artists: itunesArtists,
    albums: itunesAlbums,
    playlists: itunesPlaylists,
  };
}

function slicePool(
  pool: SearchPool,
  type: SearchType,
  page: number,
  limit: number
): Record<string, unknown> {
  const slice = <T>(items: T[]) => ({
    data: items.slice((page - 1) * limit, page * limit),
    meta: meta(page, limit, items.length),
  });
  const result: Record<string, unknown> = {};
  if (type === 'all' || type === 'tracks') result.tracks = slice(pool.tracks);
  if (type === 'all' || type === 'artists') result.artists = slice(pool.artists);
  if (type === 'all' || type === 'albums') result.albums = slice(pool.albums);
  if (type === 'all' || type === 'playlists') result.playlists = slice(pool.playlists);
  return result;
}

/** Merges iTunes + Deezer results, deduping by normalized title+artist. */
function mergeTrackResults(a: CanonicalTrack[], b: CanonicalTrack[]): CanonicalTrack[] {
  const seen = new Set<string>();
  const merged: CanonicalTrack[] = [];
  const push = (t: CanonicalTrack) => {
    const key = `${normalizeText(t.title)}|${normalizeText(t.artists[0]?.name ?? '')}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(t);
  };
  for (const t of a) push(t);
  for (const t of b) push(t);
  return merged;
}

async function resolveStream(
  ytdlp: YtdlpResolver,
  cache: SearchCache,
  cacheKey: string,
  track: CanonicalTrack,
  directUrl?: string
): Promise<ResolvedStreamData | null> {
  if (!ytdlp.isAvailable()) {
    throw new AppError('YTDLP_UNAVAILABLE', 'yt-dlp is not available on this server', 503);
  }

  const cached = await cache.get<ResolvedStreamData>(cacheKey);
  if (cached) return cached;

  const stream = directUrl
    ? await ytdlp.resolve(directUrl)
    : await ytdlp.resolveByQuery(
        track.artists[0]?.name ?? '',
        track.title,
        track.durationMs > 0 ? track.durationMs : null
      );
  if (!stream) return null;

  const value: ResolvedStreamData = {
    uri: stream.url,
    provider: stream.provider,
    mimeType: stream.mimeType,
  };
  // yt-dlp resolution is the slowest step in playback (up to tens of seconds),
  // but the resolved YouTube/SoundCloud URLs are stable — cache them long so
  // repeat plays are instant.
  await cache.set(cacheKey, value, 6 * 3600);
  return value;
}

/** Builds a canonical track directly from Spotify metadata for tracks the
 * catalog search can't match. The download pipeline resolves sources for any
 * canonical track via YouTube/SoundCloud search, so these remain playable and
 * downloadable even without a catalog entry. */
function spotifyToTrack(raw: SpotifyRawTrack): CanonicalTrack {
  const spotifyId = raw.uri.replace(/^spotify:track:/, '');
  return {
    id: `spotify:${spotifyId}`,
    title: raw.title,
    artists: raw.artists.map((name) => ({
      id: `spotify:${name}`,
      name,
      providerIds: {},
      genres: [],
    })),
    durationMs: raw.durationMs,
    providerIds: { spotify: spotifyId },
    explicit: false,
  };
}

/** Attempts to match a Spotify track to a catalog entry, trying iTunes first,
 * then Deezer. Returns null when neither provider yields a confident match. */
async function matchSpotifyTrack(
  raw: SpotifyRawTrack,
  itunes: ItunesAdapter,
  deezer: DeezerAdapter
): Promise<CanonicalTrack | null> {
  const query = [raw.artists[0], raw.title].filter(Boolean).join(' ');
  const matchFrom = (candidates: CanonicalTrack[]) =>
    pickBestMatch(
      { title: raw.title, artist: raw.artists[0] ?? null, durationMs: raw.durationMs || null },
      candidates.map((t) => ({
        title: t.title,
        artist: t.artists[0]?.name,
        durationMs: t.durationMs,
        ref: t,
      }))
    )?.candidate.ref as CanonicalTrack | undefined;

  const itunesCandidates = await itunes.searchTracks(query, 25).catch(() => []);
  const fromItunes = matchFrom(itunesCandidates);
  if (fromItunes) return fromItunes;

  const deezerCandidates = await deezer.searchTracks(query, 25).catch(() => []);
  return matchFrom(deezerCandidates) ?? null;
}

async function resolveTrack(
  itunes: ItunesAdapter,
  deezer: DeezerAdapter,
  ytdlp: YtdlpResolver,
  id: string
): Promise<{ track: CanonicalTrack; directUrl?: string }> {
  if (isYtdlpId(id)) {
    const directUrl = decodeTrackId(id);
    if (!directUrl) throw new NotFoundError('Song');
    const info = await ytdlp.getTrackInfo(directUrl);
    if (!info) throw new NotFoundError('Song');
    const track: CanonicalTrack = {
      id,
      title: info.title,
      artists: [{ id: `ytdlp:${info.artist}`, name: info.artist, providerIds: {}, genres: [] }],
      durationMs: info.durationMs,
      artworkUrl: info.artworkUrl,
      providerIds: { [info.provider]: info.url },
      explicit: false,
    };
    return { track, directUrl };
  }

  if (id.startsWith('deezer:')) {
    const track = await deezer.lookupTrack(id.replace(/^deezer:/, ''));
    if (!track) throw new NotFoundError('Song');
    return { track };
  }

  const track = await itunes.lookupTrack(id.replace(/^itunes:/, ''));
  if (!track) throw new NotFoundError('Song');
  return { track };
}

/**
 * A cheap stable-ish impression of the on-device signals, used in the mix
 * cache key so feedback, discovery preference and play-count changes bite
 * within the 24h mix window without churning mixes on every single play
 * (counts are quantized by 20 plays).
 */
function signalFingerprint(signals: LibrarySignals | undefined): string {
  const s = signals ?? {};
  let plays = 0;
  for (const p of s.playCounts ?? []) plays += p.count;
  let skips = 0;
  for (const k of s.skipCounts ?? []) skips += k.count;
  let done = 0;
  for (const c of s.completedCounts ?? []) done += c.count;
  let thumbsUp = 0;
  let thumbsDown = 0;
  for (const t of s.thumbs ?? []) {
    if (t.value === 'up') thumbsUp += 1;
    else thumbsDown += 1;
  }
  const preference = typeof s.discoveryPreference === 'number' ? s.discoveryPreference : 0.5;
  return [
    Math.round(plays / 20),
    Math.round(skips / 50),
    Math.round(done / 20),
    thumbsUp,
    thumbsDown,
    (s.hiddenTrackIds ?? []).length,
    (s.hiddenArtistNames ?? []).length,
    preference,
  ].join(':');
}

export function buildMusicRoutes(
  app: FastifyInstance,
  itunes: ItunesAdapter,
  deezer: DeezerAdapter,
  ytdlp: YtdlpResolver,
  cache: SearchCache,
  personalization: PersonalizationService,
  signals: MusicSignalService,
  tokenService: TokenService
): void {
  // Artwork proxy: serves third-party cover images from this origin so the
  // device's HTTP cache sees one stable host with long-lived Cache-Control,
  // and the app can prefetch without hammering each image CDN directly.
  const PRIVATE_HOST_RE =
    /^(localhost$|127\.|0\.|10\.|192\.168\.|169\.254\.|\[::1\]$|172\.(1[6-9]|2\d|3[01])\.)/i;
  const ARTWORK_MAX_BYTES = 2 * 1024 * 1024;

  app.get('/music/artwork', async (request, reply) => {
    const { u } = request.query as { u?: string };
    if (!u) throw new AppError('MISSING_ARTWORK_URL', 'Missing artwork url', 400);
    let target: URL;
    try {
      target = new URL(u);
    } catch {
      throw new AppError('INVALID_ARTWORK_URL', 'Invalid artwork url', 400);
    }
    if (
      (target.protocol !== 'https:' && target.protocol !== 'http:') ||
      PRIVATE_HOST_RE.test(target.hostname)
    ) {
      throw new AppError('BLOCKED_ARTWORK_URL', 'Blocked artwork url', 400);
    }

    const payload = await singleFlight<{ buf: Buffer; contentType: string }>(
      `artwork:${target.toString()}`,
      async () => {
        const upstream = await fetch(target, { signal: AbortSignal.timeout(8_000) });
        if (!upstream.ok || !upstream.body) {
          throw new AppError('ARTWORK_UPSTREAM_FAILED', 'Artwork upstream failed', 502);
        }
        const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
        if (!contentType.startsWith('image/')) {
          throw new AppError('ARTWORK_NOT_IMAGE', 'Upstream did not return an image', 415);
        }
        const declared = Number(upstream.headers.get('content-length') ?? 0);
        if (declared > ARTWORK_MAX_BYTES) {
          throw new AppError('ARTWORK_TOO_LARGE', 'Artwork too large', 502);
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        if (buf.length > ARTWORK_MAX_BYTES) {
          throw new AppError('ARTWORK_TOO_LARGE', 'Artwork too large', 502);
        }
        return { buf, contentType };
      }
    );

    reply.header('Content-Type', payload.contentType);
    reply.header('Cache-Control', 'public, max-age=604800, immutable');
    return reply.send(payload.buf);
  });

  app.get('/music/home', async (request, reply) => {
    const cacheKey = searchKey('home');
    const cached = await cache.get(cacheKey);
    if (cached) {
      reply.header('Cache-Control', 'public, max-age=900');
      return reply.send(cached);
    }

    // Real global charts (Deezer) with iTunes searches as a fallback.
    const [chartTracks, chartAlbums, chartPlaylists, chartArtists, starterMixes] =
      await Promise.all([
        deezer.chartTracks(50).catch(() => [] as CanonicalTrack[]),
        deezer.chartAlbums(25).catch(() => [] as CanonicalAlbum[]),
        deezer.chartPlaylists(10).catch(() => [] as CanonicalPlaylist[]),
        deezer.chartArtists(10).catch(() => [] as CanonicalArtist[]),
        personalization.buildStarterMixesPublic(deezer).catch(() => []),
      ]);

    const popularTracks =
      chartTracks.length > 0 ? chartTracks : await itunes.searchTracks('trending music', 10);
    const newAlbums =
      chartAlbums.length > 0 ? chartAlbums : await itunes.searchAlbums('new releases', 12);
    const topPlaylists =
      chartPlaylists.length > 0
        ? chartPlaylists
        : await itunes.searchPlaylists('top playlists', 10);
    const topArtists =
      chartArtists.length > 0 ? chartArtists : await itunes.searchArtists('popular artists', 10);

    const feed = {
      popularTracks,
      newAlbums,
      topPlaylists,
      topArtists,
      starterMixes,
    };

    await cache.set(cacheKey, feed, 900);
    reply.header('Cache-Control', 'public, max-age=900');
    return reply.send(feed);
  });

  app.post(
    '/music/home/personalized',
    { preHandler: authGuard(tokenService) },
    async (request, reply) => {
      const { userId } = (request as AuthenticatedRequest).auth;
      const body = (request.body ?? {}) as { library?: unknown };
      const library: LibraryPayload = parseLibraryPayload(body.library);

      try {
        await syncUserPlaylists(userId, library);
      } catch (err) {
        request.log.warn({ err }, 'Failed to sync user playlists');
      }

      // Mixes keep a stable identity for 24h and regenerate gradually
      // (a refresh keeps ~60% of the previous tracks), so they never
      // reshuffle completely between opens. The signal fingerprint shifts
      // the key when feedback or preference meaningfully change.
      const mixKey = `person:mix:${userId}:${signalFingerprint(library.signals)}`;
      const cachedMixes = await cache.get<DailyMix[]>(mixKey);
      let mixes: DailyMix[] = [];
      if (cachedMixes) {
        mixes = cachedMixes;
      } else {
        const previous = await cache.getStale<DailyMix[]>(mixKey);
        mixes = await personalization.buildMixes(userId, itunes, deezer, {
          library,
          previous: previous ?? undefined,
        });
        if (mixes.length > 0) await cache.set(mixKey, mixes, 24 * 3600);
      }

      const feed = await personalization.buildHomeFeed(userId, itunes, deezer, { library, mixes });
      return reply.send(feed);
    }
  );

  // Recommendation-quality diagnostics for admin tooling.
  app.get(
    '/admin/recommendations/diagnostics',
    { preHandler: adminGuard(tokenService) },
    async (request) => {
      const { userId } = request.query as { userId?: unknown };
      if (typeof userId !== 'string' || !userId) {
        throw new ValidationError('userId is required');
      }
      return personalization.diagnostics(userId, itunes, deezer);
    }
  );

  app.post('/music/history', { preHandler: authGuard(tokenService) }, async (request) => {
    const { userId } = (request as AuthenticatedRequest).auth;
    const body = (request.body ?? {}) as Record<string, unknown>;
    await signals.recordPlay(userId, {
      trackId: typeof body.trackId === 'string' ? body.trackId : '',
      trackTitle: typeof body.trackTitle === 'string' ? body.trackTitle : null,
      trackArtist: typeof body.trackArtist === 'string' ? body.trackArtist : null,
      trackAlbum: typeof body.trackAlbum === 'string' ? body.trackAlbum : null,
      trackArtwork: typeof body.trackArtwork === 'string' ? body.trackArtwork : null,
      durationMs: typeof body.durationMs === 'number' ? body.durationMs : null,
    });
    // Recommended sections rebuild from fresh signal on every request; the
    // cached mix set keeps its identity and refreshes gradually on its own
    // TTL instead of being wiped here.
    return { ok: true };
  });

  app.post(
    '/music/history/collections',
    { preHandler: authGuard(tokenService) },
    async (request) => {
      const { userId } = (request as AuthenticatedRequest).auth;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const itemType = body.itemType;
      await signals.recordCollectionPlay(userId, {
        itemId: typeof body.itemId === 'string' ? body.itemId : '',
        itemType:
          itemType === 'mix' || itemType === 'album' || itemType === 'playlist' ? itemType : 'mix',
        title: typeof body.title === 'string' ? body.title : '',
        subtitle: typeof body.subtitle === 'string' ? body.subtitle : null,
        artworkUrl: typeof body.artworkUrl === 'string' ? body.artworkUrl : null,
      });
      return { ok: true };
    }
  );

  app.put('/music/favorites', { preHandler: authGuard(tokenService) }, async (request, reply) => {
    const { userId } = (request as AuthenticatedRequest).auth;
    const body = (request.body ?? {}) as { tracks?: unknown };
    const tracks = Array.isArray(body.tracks)
      ? body.tracks
          .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
          .map((t) => ({
            trackId: typeof t.trackId === 'string' ? t.trackId : '',
            trackTitle: typeof t.trackTitle === 'string' ? t.trackTitle : null,
            trackSubtitle: typeof t.trackSubtitle === 'string' ? t.trackSubtitle : null,
          }))
      : [];
    await signals.syncFavorites(userId, tracks);
    return reply.send({ ok: true });
  });

  app.get('/music/search', async (request, reply) => {
    const q = request.query as Record<string, unknown>;
    const query = String(q.q ?? '').trim();
    const type = (String(q.type ?? 'all') as SearchType) || 'all';
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(Math.max(1, Number(q.limit ?? 25)), 50);

    if (query.length < 2) {
      throw new ValidationError('Search query must be at least 2 characters');
    }

    // The pool is cached page-agnostically so every keystroke/page shares one
    // upstream fetch; pagination slices the cached pool per request.
    const fetchLimit = Math.min(50, Math.max(limit, 25));
    const cacheKey = searchKey(query, type, String(fetchLimit));

    let pool = await cache.get<SearchPool>(cacheKey);
    if (!pool) {
      pool = await singleFlight(cacheKey, () =>
        buildSearchPool(query, type, itunes, deezer, fetchLimit)
      );
      void cache.set(cacheKey, pool, 300).catch(() => {});
    }

    reply.header('Cache-Control', 'public, max-age=60');
    return reply.send(slicePool(pool, type, page, limit));
  });

  /**
   * Imports a public Spotify playlist from a URL/link. Resolves each fetched
   * track to a canonical track (via iTunes + Deezer search + variant-aware
   * matching) so the caller can save it as a Sinc playlist and/or queue
   * downloads. Tracks that can't be matched to a catalog entry are kept as
   * synthetic canonical tracks built from the Spotify metadata, so every track
   * can still be saved and downloaded (the download pipeline resolves sources
   * via YouTube/SoundCloud search).
   */
  app.post(
    '/music/import/spotify',
    { preHandler: authGuard(tokenService) },
    async (request, reply) => {
      const body = (request.body ?? {}) as { url?: unknown };
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (!url) throw new ValidationError('url is required');

      const id = parsePlaylistId(url);
      if (!id) throw new ValidationError('Not a valid Spotify playlist link');

      const playlist = await fetchPlaylistTracks(id);

      const tracks: CanonicalTrack[] = [];
      const seen = new Set<string>();
      let matched = 0;
      let unresolved = 0;
      let duplicates = 0;

      // Resolve in small concurrent batches so we never hammer the catalog APIs.
      const batchSize = 8;
      for (let i = 0; i < playlist.tracks.length; i += batchSize) {
        const batch = playlist.tracks.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(
            async (
              raw: SpotifyRawTrack
            ): Promise<{ track: CanonicalTrack; resolved: boolean } | null> => {
              const query = [raw.artists[0], raw.title].filter(Boolean).join(' ');
              const match = await matchSpotifyTrack(raw, itunes, deezer);
              if (match) return { track: match, resolved: true };
              return { track: spotifyToTrack(raw), resolved: false };
            }
          )
        );
        for (const result of results) {
          if (!result) continue;
          const key = `${normalizeText(result.track.title)}|${normalizeText(result.track.artists[0]?.name ?? '')}`;
          if (seen.has(key)) {
            duplicates += 1;
            continue;
          }
          seen.add(key);
          if (result.resolved) matched += 1;
          else unresolved += 1;
          tracks.push(result.track);
        }
      }

      return reply.send({
        playlist: {
          id: playlist.id,
          name: playlist.name,
          owner: playlist.owner,
          artworkUrl: playlist.artworkUrl,
          totalCount: playlist.totalCount ?? playlist.tracks.length,
          truncated: playlist.truncated,
        },
        tracks,
        counts: {
          fetched: playlist.tracks.length,
          matched,
          unresolved,
          duplicates,
        },
      });
    }
  );

  app.get('/music/tracks/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { track, directUrl } = await resolveTrack(itunes, deezer, ytdlp, id);
    const stream = await resolveStream(ytdlp, cache, `resolve:${id}`, track, directUrl);
    return {
      track,
      sources: stream
        ? [
            {
              uri: stream.uri,
              mimeType: stream.mimeType,
              quality: 'high',
              provider: stream.provider,
            },
          ]
        : [],
    };
  });

  app.get('/music/tracks/:id/play', async (request) => {
    const { id } = request.params as { id: string };
    const { track, directUrl } = await resolveTrack(itunes, deezer, ytdlp, id);
    const stream = await resolveStream(ytdlp, cache, `resolve:${id}`, track, directUrl);
    if (!stream) throw new NotFoundError('Stream');
    return {
      uri: stream.uri,
      mimeType: stream.mimeType,
      quality: 'high',
      provider: stream.provider,
      expiresIn: 3600,
    };
  });

  app.get('/music/albums/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const cacheKey = `lookup:album:${id}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.send(cached);
    }

    let result: { album: CanonicalAlbum; tracks: CanonicalTrack[] } | null = null;
    if (id.startsWith('deezer:')) {
      result = await deezer.lookupAlbum(id.slice('deezer:'.length));
    } else {
      result = await itunes.lookupAlbum(id.replace(/^itunes:/, ''));
    }
    if (!result) throw new NotFoundError('Album');
    await cache.set(cacheKey, result, 3600);
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.send(result);
  });

  app.get('/music/artists/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const cacheKey = `lookup:artist:${id}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.send(cached);
    }

    let result: {
      artist: CanonicalArtist;
      albums: CanonicalAlbum[];
      topTracks: CanonicalTrack[];
    } | null = null;
    if (id.startsWith('deezer:')) {
      result = await deezer.lookupArtist(id.slice('deezer:'.length));
    } else {
      result = await itunes.lookupArtist(id.replace(/^itunes:/, ''));
    }
    if (!result) throw new NotFoundError('Artist');
    await cache.set(cacheKey, result, 3600);
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.send(result);
  });

  app.get('/music/playlists/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const playlistId = id.replace(/^(itunes|deezer):/, '');
    const cacheKey = `lookup:playlist:${id}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.send(cached);
    }

    if (id.startsWith('deezer:')) {
      const result = await deezer.lookupPlaylist(playlistId);
      if (!result) throw new NotFoundError('Playlist');
      const value = { playlist: result.playlist, tracks: result.tracks };
      await cache.set(cacheKey, value, 3600);
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.send(value);
    }

    const result = await itunes.lookupAlbum(playlistId);
    if (!result) throw new NotFoundError('Playlist');

    const playlist: CanonicalPlaylist = {
      id: result.album.id,
      name: result.album.title,
      description: undefined,
      artworkUrl: result.album.artworkUrl,
      owner: { id: result.album.artist.id, name: result.album.artist.name },
      isCollaborative: false,
      trackCount: result.tracks.length,
      providerIds: result.album.providerIds,
      createdAt: '',
      updatedAt: '',
    };

    const value = { playlist, tracks: result.tracks };
    await cache.set(cacheKey, value, 3600);
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.send(value);
  });
}
