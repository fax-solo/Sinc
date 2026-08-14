import { QueryClient } from '@tanstack/react-query';
import { ErrorCodes, SincError } from '@sinc/shared';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => {
          if (error instanceof SincError) {
            if (error.code === ErrorCodes.UNAUTHORIZED) return false;
            return error.retryable && failureCount < 2;
          }
          return failureCount < 2;
        },
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: (failureCount, error) =>
          error instanceof SincError ? error.retryable && failureCount < 2 : false,
      },
    },
  });
}
