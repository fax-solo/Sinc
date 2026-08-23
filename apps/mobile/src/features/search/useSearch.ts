import { useQuery } from '@tanstack/react-query';
import { musicApi, type SearchResults, type SearchType } from '../../api/music';
import { getCachedSearch, setCachedSearch } from '../../api/resultCache';
import { track } from '../../services/analytics/analytics';
import { MIN_QUERY_CHARS } from './searchStore';

export function useSearch(query: string, type: SearchType, enabled = true) {
  const trimmed = query.trim();
  const ready = enabled && trimmed.length >= MIN_QUERY_CHARS;
  const cached = ready ? getCachedSearch(trimmed, type) : null;

  return useQuery<SearchResults>({
    queryKey: ['search', trimmed, type],
    queryFn: async ({ signal }) => {
      const results = await musicApi.search(trimmed, type, signal);
      setCachedSearch(trimmed, type, results);
      const total =
        (results.tracks?.data.length ?? 0) +
        (results.artists?.data.length ?? 0) +
        (results.albums?.data.length ?? 0) +
        (results.playlists?.data.length ?? 0);
      track('search:success', undefined, { type, results: total });
      return results;
    },
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.at,
    placeholderData: (prev) => prev,
    enabled: ready,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
