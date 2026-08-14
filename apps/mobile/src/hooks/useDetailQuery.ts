import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ErrorCodes, OfflineError, SincError } from '@sinc/shared';

export type DetailQueryState = 'loading' | 'offline' | 'notFound' | 'error' | 'ready';

/**
 * Detail-screen query wrapper: maps API errors into the four render states
 * (loading skeleton, offline, 404, generic error) every detail screen needs.
 */
export function useDetailQuery<T>(
  key: string[],
  queryFn: () => Promise<T>,
): UseQueryResult<T> & { state: DetailQueryState } {
  const query = useQuery({ queryKey: key, queryFn });

  let state: DetailQueryState = 'loading';
  if (!query.isLoading) {
    if (query.isError) {
      const error = query.error;
      if (error instanceof OfflineError) state = 'offline';
      else if (error instanceof SincError && error.code === ErrorCodes.NOT_FOUND)
        state = 'notFound';
      else state = 'error';
    } else {
      state = 'ready';
    }
  }

  return { ...query, state };
}
