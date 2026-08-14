import { create } from 'zustand';
import { SincError, OfflineError, ErrorCodes } from '@sinc/shared';
import {
  musicApi,
  type SearchResponse,
  type SearchSuggestion,
  type SearchType,
} from '../api/music';
import { storage } from '../storage';

/**
 * Search state: debounced instant search (typeahead suggestions + results),
 * recent searches persisted in KVStorage, per-type filtering, and infinite
 * scroll pagination. Offline and provider errors map to distinct UI states.
 */

export type SearchStatus = 'idle' | 'loading' | 'success' | 'error' | 'offline';

export const DEBOUNCE_MS = 400;
export const SUGGEST_MIN_CHARS = 2;
export const RECENT_MAX = 10;

export const RECENT_STORAGE_KEY = 'sinc.searchRecent';

interface SearchState {
  query: string;
  status: SearchStatus;
  error: string | null;
  results: SearchResponse | null;
  suggestions: SearchSuggestion[];
  recentSearches: string[];
  type: SearchType;
  page: number;
  hasMore: boolean;
  total: number;

  setQuery: (q: string) => void;
  /** Immediate full search (submit / tapping a recent search). */
  search: (q: string, recordRecent?: boolean) => Promise<void>;
  runSearch: (q: string) => Promise<void>;
  loadMore: () => Promise<void>;
  setType: (type: SearchType) => void;
  clear: () => void;
  removeRecent: (q: string) => void;
  clearRecent: () => void;
  /** Test hook: cancel pending debounce and reset to idle. */
  reset: () => void;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function schedule(fn: () => void, ms: number): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    fn();
  }, ms);
}

function cancelPending(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

function readRecent(): string[] {
  const raw = storage.getString(RECENT_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .slice(0, RECENT_MAX);
  } catch {
    storage.remove(RECENT_STORAGE_KEY);
    return [];
  }
}

function persistRecent(recent: string[]): void {
  if (recent.length === 0) {
    storage.remove(RECENT_STORAGE_KEY);
  } else {
    storage.setString(RECENT_STORAGE_KEY, JSON.stringify(recent.slice(0, RECENT_MAX)));
  }
}

function addRecentEntry(current: string[], query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return current;
  return [trimmed, ...current.filter((entry) => entry !== trimmed)].slice(0, RECENT_MAX);
}

function mergeGroups<T>(
  existing: { data: T[]; meta: SearchResponse['tracks']['meta'] },
  incoming: { data: T[]; meta: SearchResponse['tracks']['meta'] },
  getId: (item: T) => string | number | undefined,
): { data: T[]; meta: SearchResponse['tracks']['meta'] } {
  const seen = new Set<string | number>();
  for (const item of existing.data) {
    const id = getId(item);
    if (id != null) seen.add(id);
  }
  const merged = [...existing.data];
  for (const item of incoming.data) {
    const id = getId(item);
    if (id != null && seen.has(id)) continue;
    if (id != null) seen.add(id);
    merged.push(item);
  }
  return { data: merged, meta: incoming.meta };
}

function typeParam(type: SearchType): 'songs' | 'artists' | 'albums' | 'playlists' | undefined {
  if (type === 'all') return undefined;
  return type;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  status: 'idle',
  error: null,
  results: null,
  suggestions: [],
  recentSearches: readRecent(),
  type: 'all',
  page: 1,
  hasMore: false,
  total: 0,

  setQuery: (q) => {
    cancelPending();
    set({ query: q, error: null });
    if (!q.trim()) {
      set({ status: 'idle', results: null, suggestions: [], hasMore: false, total: 0 });
      return;
    }
    schedule(() => {
      void get().runSearch(q.trim());
    }, DEBOUNCE_MS);
  },

  search: async (q, recordRecent = true) => {
    cancelPending();
    const trimmed = q.trim();
    if (!trimmed) return;
    set({ query: trimmed });
    if (recordRecent) {
      const recent = addRecentEntry(get().recentSearches, trimmed);
      persistRecent(recent);
      set({ recentSearches: recent });
    }
    await get().runSearch(trimmed);
  },

  runSearch: async (q) => {
    const { type } = get();
    const hasResults = get().results !== null;
    set({ status: 'loading' });
    try {
      const [results, suggestions] = await Promise.all([
        musicApi.search({ q, type: typeParam(type), limit: 20 }),
        q.length >= SUGGEST_MIN_CHARS ? musicApi.suggest(q, 8) : Promise.resolve([]),
      ]);
      const tracksMeta = results.tracks.meta;
      set({
        status: 'success',
        results,
        suggestions,
        page: 1,
        hasMore: tracksMeta.hasNext,
        total: tracksMeta.total,
      });
    } catch (error) {
      if (error instanceof OfflineError) {
        set({ status: 'offline', error: null, results: hasResults ? get().results : null });
      } else if (error instanceof SincError) {
        set({
          status: 'error',
          error: error.code === ErrorCodes.RATE_LIMITED ? 'search.tooManyRequests' : 'search.error',
          results: hasResults ? get().results : null,
        });
      } else {
        set({ status: 'error', error: 'search.error', results: hasResults ? get().results : null });
      }
    }
  },

  loadMore: async () => {
    const { query, type, page, hasMore, status } = get();
    if (!hasMore || status !== 'success' || !query.trim()) return;
    const nextPage = page + 1;
    set({ status: 'loading' });
    try {
      const results = await musicApi.search({
        q: query.trim(),
        type: typeParam(type),
        page: nextPage,
        limit: 20,
      });
      const current = get().results;
      set({
        status: 'success',
        results: current
          ? {
              tracks: mergeGroups(current.tracks, results.tracks, (entry) => entry.track.id),
              artists: mergeGroups(current.artists, results.artists, (entry) => entry.id),
              albums: mergeGroups(current.albums, results.albums, (entry) => entry.id),
              playlists: mergeGroups(
                current.playlists,
                results.playlists,
                (entry) => (entry as { id?: string }).id,
              ),
            }
          : results,
        page: nextPage,
        hasMore: results.tracks.meta.hasNext,
        total: results.tracks.meta.total,
      });
    } catch (error) {
      if (error instanceof OfflineError) set({ status: 'offline' });
      else set({ status: 'error', error: 'search.error' });
    }
  },

  setType: (type) => {
    if (type === get().type) return;
    set({ type });
    const q = get().query.trim();
    if (q) void get().runSearch(q);
  },

  clear: () => {
    cancelPending();
    set({
      query: '',
      status: 'idle',
      error: null,
      results: null,
      suggestions: [],
      page: 1,
      hasMore: false,
      total: 0,
    });
  },

  removeRecent: (q) => {
    const recent = get().recentSearches.filter((entry) => entry !== q);
    persistRecent(recent);
    set({ recentSearches: recent });
  },

  clearRecent: () => {
    persistRecent([]);
    set({ recentSearches: [] });
  },

  reset: () => {
    cancelPending();
    set({
      query: '',
      status: 'idle',
      error: null,
      results: null,
      suggestions: [],
      page: 1,
      hasMore: false,
      total: 0,
    });
  },
}));
