# Mobile Architecture - TanStack Query Configuration

## Query Client Setup

```typescript
// lib/queryClient.ts
import { QueryClient, PersistQueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/query-sync-storage-persister';
import { createWatermelonPersister } from '@/database/watermelonPersister';
import { database } from '@/database';

// Create query client with optimized defaults
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data freshness
      staleTime: 5 * 60 * 1000, // 5 minutes - data considered fresh
      gcTime: 30 * 60 * 1000, // 30 minutes - garbage collection (formerly cacheTime)

      // Retry logic
      retry: (failureCount, error: any) => {
        // Don't retry auth errors
        if (error?.response?.status === 401 || error?.response?.status === 403) {
          return false;
        }
        // Retry network errors up to 3 times
        if (error?.code === 'ECONNABORTED' || error?.message?.includes('Network')) {
          return failureCount < 3;
        }
        // Retry other errors up to 2 times
        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),

      // Refetch behavior
      refetchOnWindowFocus: false, // Don't refetch on focus (mobile)
      refetchOnReconnect: 'always', // Refetch when network reconnects
      refetchOnMount: 'always', // Refetch when component mounts if stale

      // Network mode
      networkMode: 'online', // Only fetch when online

      // Deduplication
      // Multiple components requesting same query = single request

      // Placeholder data for smoother UX
      placeholderData: (previousData) => previousData,
    },
    mutations: {
      retry: 0, // Don't retry mutations by default
      networkMode: 'online', // Only mutate when online
      // Optimistic updates handled via onMutate
    },
  },
});

// Persist query cache for offline support
if (__DEV__) {
  // In development, use simpler persister
  persistQueryClient({
    queryClient,
    persister: createWatermelonPersister(database),
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    buster: 'sinc-query-v1', // Invalidate on schema changes
  });
} else {
  // Production: more aggressive persistence
  persistQueryClient({
    queryClient,
    persister: createWatermelonPersister(database),
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    buster: 'sinc-query-v1',
    // Only persist successful queries
    filter: (mutation) => mutation.state.status === 'success',
  });
}

// Query key factories for consistent key structure
export const queryKeys = {
  // Auth
  auth: {
    me: () => ['auth', 'me'] as const,
    sessions: () => ['auth', 'sessions'] as const,
  },

  // Home
  home: {
    sections: () => ['home', 'sections'] as const,
    continueListening: () => ['home', 'continue-listening'] as const,
    recentlyPlayed: (limit?: number) => ['home', 'recently-played', limit] as const,
    recentlyDownloaded: (limit?: number) => ['home', 'recently-downloaded', limit] as const,
    favorites: (limit?: number) => ['home', 'favorites', limit] as const,
    playlists: (limit?: number) => ['home', 'playlists', limit] as const,
    recommendations: (params?: RecommendationParams) => ['home', 'recommendations', params] as const,
    quickMixes: () => ['home', 'quick-mixes'] as const,
  },

  // Search
  search: {
    results: (query: string, filters?: SearchFilters) => ['search', 'results', query, filters] as const,
    suggestions: (query: string) => ['search', 'suggestions', query] as const,
    recent: () => ['search', 'recent'] as const,
    trending: () => ['search', 'trending'] as const,
  },

  // Library
  library: {
    tracks: (params?: LibraryTrackParams) => ['library', 'tracks', params] as const,
    artists: (params?: LibraryArtistParams) => ['library', 'artists', params] as const,
    albums: (params?: LibraryAlbumParams) => ['library', 'albums', params] as const,
    playlists: (params?: LibraryPlaylistParams) => ['library', 'playlists', params] as const,
    favorites: (params?: PaginationParams) => ['library', 'favorites', params] as const,
    recentlyPlayed: (params?: PaginationParams) => ['library', 'recently-played', params] as const,
    recentlyDownloaded: (params?: PaginationParams) => ['library', 'recently-downloaded', params] as const,
    history: (params?: HistoryParams) => ['library', 'history', params] as const,
    downloaded: (params?: PaginationParams) => ['library', 'downloaded', params] as const,
  },

  // Music Details
  music: {
    track: (id: string) => ['music', 'track', id] as const,
    artist: (id: string) => ['music', 'artist', id] as const,
    album: (id: string) => ['music', 'album', id] as const,
    playlist: (id: string) => ['music', 'playlist', id] as const,
    trackSources: (id: string) => ['music', 'track', id, 'sources'] as const,
    trackLyrics: (id: string) => ['music', 'track', id, 'lyrics'] as const,
    relatedTracks: (id: string) => ['music', 'track', id, 'related'] as const,
    artistTopTracks: (id: string) => ['music', 'artist', id, 'top-tracks'] as const,
    artistAlbums: (id: string) => ['music', 'artist', id, 'albums'] as const,
    artistRelated: (id: string) => ['music', 'artist', id, 'related'] as const,
    albumTracks: (id: string) => ['music', 'album', id, 'tracks'] as const,
    playlistTracks: (id: string, params?: PaginationParams) => ['music', 'playlist', id, 'tracks', params] as const,
  },

  // Downloads
  downloads: {
    jobs: (status?: DownloadStatus[]) => ['downloads', 'jobs', status] as const,
    queue: () => ['downloads', 'queue'] as const,
    job: (id: string) => ['downloads', 'job', id] as const,
    stats: () => ['downloads', 'stats'] as const,
  },

  // Playlists
  playlists: {
    list: (params?: PaginationParams) => ['playlists', 'list', params] as const,
    detail: (id: string) => ['playlists', 'detail', id] as const,
    tracks: (id: string, params?: PaginationParams) => ['playlists', 'tracks', id, params] as const,
    userPlaylists: (userId: string) => ['playlists', 'user', userId] as const,
  },

  // Favorites
  favorites: {
    tracks: (params?: PaginationParams) => ['favorites', 'tracks', params] as const,
    artists: (params?: PaginationParams) => ['favorites', 'artists', params] as const,
    albums: (params?: PaginationParams) => ['favorites', 'albums', params] as const,
    check: (trackId: string) => ['favorites', 'check', trackId] as const,
  },

  // History
  history: {
    list: (params?: HistoryParams) => ['history', 'list', params] as const,
    stats: () => ['history', 'stats'] as const,
  },

  // Recommendations
  recommendations: {
    forYou: (params?: RecommendationParams) => ['recommendations', 'for-you', params] as const,
    similar: (trackId: string) => ['recommendations', 'similar', trackId] as const,
    artistMix: (artistId: string) => ['recommendations', 'artist-mix', artistId] as const,
    genreMix: (genre: string) => ['recommendations', 'genre-mix', genre] as const,
    discovery: (params?: RecommendationParams) => ['recommendations', 'discovery', params] as const,
  },

  // Lyrics
  lyrics: {
    search: (track: TrackMetadata) => ['lyrics', 'search', track] as const,
    byId: (id: string) => ['lyrics', 'by-id', id] as const,
    synced: (trackId: string) => ['lyrics', 'synced', trackId] as const,
  },

  // Settings
  settings: {
    all: () => ['settings', 'all'] as const,
    playback: () => ['settings', 'playback'] as const,
    downloads: () => ['settings', 'downloads'] as const,
    lyrics: () => ['settings', 'lyrics'] as const,
    notifications: () => ['settings', 'notifications'] as const,
    appearance: () => ['settings', 'appearance'] as const,
    privacy: () => ['settings', 'privacy'] as const,
    security: () => ['settings', 'security'] as const,
    storage: () => ['settings', 'storage'] as const,
  },

  // Notifications
  notifications: {
    list: (params?: NotificationParams) => ['notifications', 'list', params] as const,
    unreadCount: () => ['notifications', 'unread-count'] as const,
    preferences: () => ['notifications', 'preferences'] as const,
  },

  // Admin
  admin: {
    dashboard: () => ['admin', 'dashboard'] as const,
    users: (params?: AdminUserParams) => ['admin', 'users', params] as const,
    providers: () => ['admin', 'providers'] as const,
    logs: (params?: AdminLogParams) => ['admin', 'logs', params] as const,
    health: () => ['admin', 'health'] as const,
  },
} as const;

// Types for query parameters
interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

interface SearchFilters {
  type?: 'song' | 'artist' | 'album' | 'playlist';
  artist?: string;
  album?: string;
  duration?: { min?: number; max?: number };
  availability?: 'all' | 'streamable' | 'downloadable' | 'downloaded';
  downloaded?: boolean;
  favorite?: boolean;
}

interface LibraryTrackParams extends PaginationParams {
  sort?: 'recently_added' | 'recently_played' | 'title' | 'artist' | 'album' | 'duration';
  filter?: 'all' | 'downloaded' | 'favorite';
  artistId?: string;
  albumId?: string;
  playlistId?: string;
}

interface LibraryArtistParams extends PaginationParams {
  sort?: 'name' | 'play_count' | 'recently_played';
}

interface LibraryAlbumParams extends PaginationParams {
  sort?: 'title' | 'artist' | 'release_date' | 'recently_added';
}

interface LibraryPlaylistParams extends PaginationParams {
  sort?: 'title' | 'track_count' | 'recently_updated' | 'created_at';
}

interface HistoryParams extends PaginationParams {
  from?: string;
  to?: string;
  sourceType?: 'LOCAL' | 'REMOTE' | 'CACHED';
}

interface RecommendationParams extends PaginationParams {
  seed?: string; // track, artist, or genre seed
  type?: 'familiar' | 'similar' | 'discovery' | 'mix';
}

interface NotificationParams extends PaginationParams {
  type?: 'download' | 'recommendation' | 'account' | 'update' | 'security';
  read?: boolean;
}

interface AdminUserParams extends PaginationParams {
  search?: string;
  role?: 'USER' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN';
  status?: 'active' | 'suspended' | 'pending_verification';
}

interface AdminLogParams extends PaginationParams {
  level?: 'info' | 'warn' | 'error' | 'debug';
  service?: string;
  userId?: string;
}

// Query invalidation helpers
export const invalidation = {
  // Invalidate all queries for an entity
  track: (id: string) => queryClient.invalidateQueries({ queryKey: ['music', 'track', id] }),
  artist: (id: string) => queryClient.invalidateQueries({ queryKey: ['music', 'artist', id] }),
  album: (id: string) => queryClient.invalidateQueries({ queryKey: ['music', 'album', id] }),
  playlist: (id: string) => queryClient.invalidateQueries({ queryKey: ['music', 'playlist', id] }),

  // Invalidate lists
  library: () => queryClient.invalidateQueries({ queryKey: ['library'] }),
  home: () => queryClient.invalidateQueries({ queryKey: ['home'] }),
  playlists: () => queryClient.invalidateQueries({ queryKey: ['playlists'] }),
  favorites: () => queryClient.invalidateQueries({ queryKey: ['favorites'] }),
  history: () => queryClient.invalidateQueries({ queryKey: ['history'] }),
  downloads: () => queryClient.invalidateQueries({ queryKey: ['downloads'] }),
  recommendations: () => queryClient.invalidateQueries({ queryKey: ['recommendations'] }),
  search: () => queryClient.invalidateQueries({ queryKey: ['search'] }),

  // Invalidate everything (use sparingly)
  all: () => queryClient.invalidateQueries(),
};

// Prefetching helpers for better UX
export const prefetch = {
  track: (id: string) => queryClient.prefetchQuery({
    queryKey: queryKeys.music.track(id),
    queryFn: () => api.music.getTrack(id),
    staleTime: 10 * 60 * 1000,
  }),

  artist: (id: string) => queryClient.prefetchQuery({
    queryKey: queryKeys.music.artist(id),
    queryFn: () => api.music.getArtist(id),
    staleTime: 10 * 60 * 1000,
  }),

  album: (id: string) => queryClient.prefetchQuery({
    queryKey: queryKeys.music.album(id),
    queryFn: () => api.music.getAlbum(id),
    staleTime: 10 * 60 * 1000,
  }),

  playlist: (id: string) => queryClient.prefetchQuery({
    queryKey: queryKeys.music.playlist(id),
    queryFn: () => api.music.getPlaylist(id),
    staleTime: 5 * 60 * 1000,
  }),

  // Prefetch next page for infinite scrolling
  nextPage: <T>(queryKey: readonly unknown[], fetchNextPage: () => Promise<T>) => {
    queryClient.prefetchQuery({
      queryKey,
      queryFn: fetchNextPage,
    });
  },
};

// Query client provider wrapper
export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <PersistQueryClientProvider client={queryClient}>
      {children}
    </PersistQueryClientProvider>
  );
}
```

## Custom Hooks for Common Patterns

```typescript
// hooks/useInfiniteQuery.ts
import { useInfiniteQuery, UseInfiniteQueryOptions } from '@tanstack/react-query';
import { queryKeys, api } from '@/lib';

export function useInfiniteTracks(params: LibraryTrackParams = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.library.tracks(params),
    queryFn: ({ pageParam = 1 }) => api.library.getTracks({ ...params, page: pageParam }),
    getNextPageParam: (lastPage) => {
      if (lastPage.page < lastPage.totalPages) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
  } as UseInfiniteQueryOptions);
}

export function useInfiniteSearchResults(query: string, filters?: SearchFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.search.results(query, filters),
    queryFn: ({ pageParam = 1 }) => api.search.search({ q: query, ...filters, page: pageParam }),
    getNextPageParam: (lastPage) => {
      if (lastPage.page < lastPage.totalPages) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
    enabled: query.length >= 2,
  });
}

export function useInfinitePlaylistTracks(playlistId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.music.playlistTracks(playlistId),
    queryFn: ({ pageParam = 1 }) => api.playlists.getTracks(playlistId, { page: pageParam }),
    getNextPageParam: (lastPage) => {
      if (lastPage.page < lastPage.totalPages) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
  });
}
```

```typescript
// hooks/useOptimisticMutation.ts
import { useMutation, useQueryClient, MutationFunction } from '@tanstack/react-query';
import { queryKeys, invalidation } from '@/lib/queryClient';
import { offlineQueue } from '@/lib/offline/OfflineMutationQueue';

interface OptimisticMutationOptions<TData, TVariables, TContext> {
  mutationFn: MutationFunction<TData, TVariables>;
  queryKey: readonly unknown[];
  optimisticUpdate: (oldData: any, variables: TVariables) => any;
  mutationType: 'create' | 'update' | 'delete';
  entity: string;
  onSuccess?: (data: TData, variables: TVariables, context: TContext) => void;
  onError?: (error: Error, variables: TVariables, context: TContext) => void;
}

export function useOptimisticMutation<TData, TVariables, TContext = unknown>({
  mutationFn,
  queryKey,
  optimisticUpdate,
  mutationType,
  entity,
  onSuccess,
  onError,
}: OptimisticMutationOptions<TData, TVariables, TContext>) {
  const queryClient = useQueryClient();

  return useMutation<TData, Error, TVariables, TContext>({
    mutationFn,
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot previous value
      const previous = queryClient.getQueryData(queryKey);

      // Optimistically update
      queryClient.setQueryData(queryKey, (old) => optimisticUpdate(old, variables));

      // Queue for offline sync
      const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await offlineQueue.enqueue({
        id: tempId,
        type: mutationType,
        entity: entity as any,
        data: { ...variables, tempId },
        timestamp: Date.now(),
        retryCount: 0,
      });

      return { previous, tempId } as TContext;
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      onError?.(error, variables, context);
    },
    onSuccess: (data, variables, context) => {
      // Remove from offline queue
      if (context?.tempId) {
        offlineQueue.remove(context.tempId);
      }
      // Invalidate and refetch
      invalidation.all(); // Or specific invalidation
      onSuccess?.(data, variables, context);
    },
    onSettled: () => {
      // Always refetch after mutation
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
```
