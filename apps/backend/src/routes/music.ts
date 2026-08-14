import { z } from 'zod';
import {
  normalizeTitle,
  paginate,
  success,
  type CanonicalAlbum,
  type CanonicalArtist,
  type CanonicalTrack,
} from '@sinc/shared';
import type { TypedApp } from '../app.js';
import type { Container } from '../container.js';
import { authGuard } from '../plugins/guard.js';
import { rateLimitHook } from '../plugins/rate-limit.js';
import { searchKey, type SearchCache } from '../persistence/search-cache.js';

const SEARCH_TTL_SECONDS = 600;
const SUGGEST_TTL_SECONDS = 3_600;
const DETAIL_TTL_SECONDS = 600;
const SOURCES_TTL_SECONDS = 120;

const SearchQuery = z.object({
  q: z.string().trim().min(1, 'search query is required').max(200),
  type: z.enum(['songs', 'artists', 'albums', 'playlists']).optional(),
  artist: z.string().trim().max(100).optional(),
  album: z.string().trim().max(100).optional(),
  durationMin: z.coerce.number().int().nonnegative().optional(),
  durationMax: z.coerce.number().int().nonnegative().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  sort: z.enum(['relevance', 'popularity', 'recent', 'title', 'artist']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
type SearchQueryInput = z.infer<typeof SearchQuery>;

const SuggestQuery = z.object({
  q: z.string().trim().min(1, 'search query is required').max(60),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

const DetailParams = z.object({
  id: z.string().trim().min(1).max(200),
});

const DetailQuery = z.object({
  provider: z.string().trim().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

type PaginationMeta = ReturnType<typeof paginate>['meta'];
type SearchResultPayload = Awaited<ReturnType<Container['catalog']['search']>>;

interface SearchPayload {
  tracks: { data: Array<{ track: CanonicalTrack; score: number }>; meta: PaginationMeta };
  artists: { data: CanonicalArtist[]; meta: PaginationMeta };
  albums: { data: CanonicalAlbum[]; meta: PaginationMeta };
  playlists: { data: unknown[]; meta: PaginationMeta };
}

export async function registerMusicRoutes(
  app: TypedApp,
  opts: { container: Container },
): Promise<void> {
  const { container } = opts;
  const guard = authGuard(container.tokenService);
  const cache: SearchCache = container.searchCache;

  app.get('/music/search', {
    onRequest: [guard, rateLimitHook(container.rateLimiter, 'search')],
    handler: async (request, reply) => {
      const query = SearchQuery.parse(request.query);
      const { type, page, limit, sort, order } = query;

      const filterKey = JSON.stringify({
        artist: query.artist,
        album: query.album,
        durationMin: query.durationMin,
        durationMax: query.durationMax,
      });
      const key = searchKey('search', query.q, `${filterKey}|type=${type ?? 'all'}`);
      const cached = await cache.get<SearchResultPayload>(key);

      let result: SearchResultPayload;
      if (cached) {
        result = cached;
      } else {
        result = await container.singleFlight.run(key, () =>
          container.catalog.search(query.q, {
            limit: Math.max(limit ?? 20, 10),
            artist: query.artist,
            album: query.album,
            durationMin: query.durationMin,
            durationMax: query.durationMax,
          }),
        );
        await cache.set(key, result, SEARCH_TTL_SECONDS);
      }

      const payload = buildSearchPayload(result, { type, page, limit, sort, order });
      return reply.send(success(payload, request.id));
    },
  });

  app.get('/music/search/suggest', {
    onRequest: [guard, rateLimitHook(container.rateLimiter, 'search')],
    handler: async (request, reply) => {
      const query = SuggestQuery.parse(request.query);
      const key = searchKey('suggest', query.q, `l=${query.limit ?? 8}`);
      const cached = await cache.get<{ suggestions: unknown[] }>(key);
      if (cached) return reply.send(success(cached, request.id));

      const suggestions = await container.singleFlight.run(key, () =>
        container.catalog.suggest(query.q, query.limit ?? 8),
      );
      const payload = { suggestions };
      await cache.set(key, payload, SUGGEST_TTL_SECONDS);
      return reply.send(success(payload, request.id));
    },
  });

  app.get('/music/tracks/:id', {
    onRequest: [guard, rateLimitHook(container.rateLimiter, 'search')],
    handler: async (request, reply) => {
      const { id } = DetailParams.parse(request.params);
      const query = DetailQuery.parse(request.query);
      const key = searchKey('detail', `track:${id}`, `p=${query.provider ?? 'any'}`);
      const cached = await cache.get<{ track: unknown; providers: unknown }>(key);
      if (cached) return reply.send(success(cached, request.id));

      const payload = await container.singleFlight.run(key, () =>
        container.catalog.getTrackDetail(id, {
          provider: query.provider,
          limit: query.limit,
          offset: query.offset,
        }),
      );
      await cache.set(key, payload, DETAIL_TTL_SECONDS);
      return reply.send(success(payload, request.id));
    },
  });

  app.get('/music/tracks/:id/sources', {
    onRequest: [guard, rateLimitHook(container.rateLimiter, 'search')],
    handler: async (request, reply) => {
      const { id } = DetailParams.parse(request.params);
      const query = DetailQuery.parse(request.query);
      const key = searchKey('sources', `track:${id}`, `p=${query.provider ?? 'any'}`);
      const cached = await cache.get<{ track: unknown; sources: unknown; providers: unknown }>(key);
      if (cached) return reply.send(success(cached, request.id));

      const payload = await container.singleFlight.run(key, () =>
        container.catalog.getTrackSources(id, { provider: query.provider }),
      );
      await cache.set(key, payload, SOURCES_TTL_SECONDS);
      return reply.send(success(payload, request.id));
    },
  });

  app.get('/music/artists/:id', {
    onRequest: [guard, rateLimitHook(container.rateLimiter, 'search')],
    handler: async (request, reply) => {
      const { id } = DetailParams.parse(request.params);
      const query = DetailQuery.parse(request.query);
      const key = searchKey('detail', `artist:${id}`, `p=${query.provider ?? 'any'}`);
      const cached = await cache.get<{ artist: unknown; providers: unknown }>(key);
      if (cached) return reply.send(success(cached, request.id));

      const payload = await container.singleFlight.run(key, () =>
        container.catalog.getArtistDetail(id, {
          provider: query.provider,
          limit: query.limit,
          offset: query.offset,
        }),
      );
      await cache.set(key, payload, DETAIL_TTL_SECONDS);
      return reply.send(success(payload, request.id));
    },
  });

  app.get('/music/albums/:id', {
    onRequest: [guard, rateLimitHook(container.rateLimiter, 'search')],
    handler: async (request, reply) => {
      const { id } = DetailParams.parse(request.params);
      const query = DetailQuery.parse(request.query);
      const key = searchKey('detail', `album:${id}`, `p=${query.provider ?? 'any'}`);
      const cached = await cache.get<{ album: unknown; providers: unknown }>(key);
      if (cached) return reply.send(success(cached, request.id));

      const payload = await container.singleFlight.run(key, () =>
        container.catalog.getAlbumDetail(id, {
          provider: query.provider,
          limit: query.limit,
          offset: query.offset,
        }),
      );
      await cache.set(key, payload, DETAIL_TTL_SECONDS);
      return reply.send(success(payload, request.id));
    },
  });

  app.get('/music/playlists/:id', {
    onRequest: [guard, rateLimitHook(container.rateLimiter, 'search')],
    handler: async (request, reply) => {
      const { id } = DetailParams.parse(request.params);
      const payload = await container.catalog.getPlaylistDetail(id);
      return reply.send(success(payload, request.id));
    },
  });

  app.get('/home', {
    onRequest: [guard, rateLimitHook(container.rateLimiter, 'search')],
    handler: async (request, reply) => {
      const payload = await container.homeFeed.build(request.auth!.userId);
      return reply.send(success(payload, request.id));
    },
  });
}

function buildSearchPayload(
  result: SearchResultPayload,
  query: {
    type?: SearchQueryInput['type'];
    page?: number;
    limit?: number;
    sort?: SearchQueryInput['sort'];
    order?: 'asc' | 'desc';
  },
): SearchPayload {
  const includeSongs = !query.type || query.type === 'songs';
  const includeArtists = !query.type || query.type === 'artists';
  const includeAlbums = !query.type || query.type === 'albums';

  const sortKey = (sort: string | undefined) =>
    sort === 'title'
      ? 'title'
      : sort === 'popularity'
        ? 'popularity'
        : sort === 'recent'
          ? 'recent'
          : 'artist';

  const tracks = includeSongs
    ? result.tracks.map((entry) => ({ track: entry.track, score: entry.score.total }))
    : [];
  const artists = includeArtists ? result.artists : [];
  const albums = includeAlbums ? result.albums : [];

  const order = query.order === 'desc' ? -1 : 1;

  const sortTracks = (items: typeof tracks) => {
    if (!query.sort || query.sort === 'relevance') return items;
    const key = sortKey(query.sort);
    return [...items].sort((a, b) => {
      let cmp = 0;
      if (key === 'title')
        cmp = normalizeTitle(a.track.title).localeCompare(normalizeTitle(b.track.title));
      else if (key === 'popularity')
        cmp = (a.track.popularityScore ?? 0) - (b.track.popularityScore ?? 0);
      else if (key === 'recent')
        cmp = (a.track.releaseDate ?? '').localeCompare(b.track.releaseDate ?? '');
      else if (key === 'artist')
        cmp = (a.track.artists[0]?.name ?? '').localeCompare(b.track.artists[0]?.name ?? '');
      return cmp * order;
    });
  };
  const sortNamed = <T extends { name: string }>(items: T[]) => {
    if (!query.sort) return items;
    return [...items].sort((a, b) => a.name.localeCompare(b.name) * order);
  };
  const sortTitled = <T extends { title: string }>(items: T[]) => {
    if (!query.sort) return items;
    return [...items].sort((a, b) => a.title.localeCompare(b.title) * order);
  };

  const slice = <T>(items: T[]): { data: T[]; meta: ReturnType<typeof paginate>['meta'] } => {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const offset = (page - 1) * limit;
    const data = items.slice(offset, offset + limit);
    return { data, meta: paginate(data, items.length, { page, limit }).meta };
  };

  return {
    tracks: slice(sortTracks(tracks)),
    artists: slice(sortNamed(artists)),
    albums: slice(sortTitled(albums)),
    playlists: slice<never>([]),
  };
}
