import { useEffect, useState } from 'react';
import type { Model } from '@nozbe/watermelondb';
import type Query from '@nozbe/watermelondb/Query';

/**
 * Subscribes a component to a WatermelonDB query. Returns records and keeps
 * them fresh on every change; pass `null` to reset to an empty list.
 */
export function useQuery<T extends Model>(query: Query<T> | null): T[] {
  const [state, setState] = useState<{ query: Query<T> | null; records: T[] }>({
    query,
    records: [],
  });

  useEffect(() => {
    if (!query) return;
    const subscription = query.observe().subscribe((records) => setState({ query, records }));
    return () => subscription.unsubscribe();
  }, [query]);

  return state.query === query ? state.records : [];
}
