import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import type { SearchType } from '../../api/music';

export const MIN_QUERY_CHARS = 2;
export const MAX_RECENT_SEARCHES = 10;

interface SearchState {
  query: string;
  type: SearchType;
  recentSearches: string[];

  setQuery: (query: string) => void;
  setType: (type: SearchType) => void;
  submit: (query: string) => void;
  removeRecent: (query: string) => void;
  clearRecent: () => void;
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set, get) => ({
      query: '',
      type: 'all',
      recentSearches: [],

      setQuery: (query) => set({ query }),

      setType: (type) => set({ type }),

      submit: (query) => {
        const trimmed = query.trim();
        if (!trimmed) return;
        set({ query: trimmed });
        const recent = [trimmed, ...get().recentSearches.filter((r) => r !== trimmed)].slice(
          0,
          MAX_RECENT_SEARCHES
        );
        set({ recentSearches: recent });
      },

      removeRecent: (query) =>
        set({ recentSearches: get().recentSearches.filter((r) => r !== query) }),

      clearRecent: () => set({ recentSearches: [] }),
    }),
    {
      name: STORAGE_KEYS.RECENT_SEARCHES,
      storage: createJSONStorage(() => ({
        getItem: (key) => storage.getString(key),
        setItem: (key, value) => storage.setString(key, value),
        removeItem: (key) => storage.remove(key),
      })),
      partialize: (state) => ({ recentSearches: state.recentSearches }),
    }
  )
);
