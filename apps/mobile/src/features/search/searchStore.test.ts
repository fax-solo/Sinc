import { beforeEach, describe, expect, it } from 'vitest';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { MAX_RECENT_SEARCHES, useSearchStore } from './searchStore';

beforeEach(() => {
  storage.remove(STORAGE_KEYS.RECENT_SEARCHES);
  useSearchStore.setState({ query: '', type: 'all', recentSearches: [] });
});

describe('searchStore', () => {
  it('submit stores trimmed queries at the front', () => {
    const store = useSearchStore.getState();
    store.submit('  Adele  ');
    store.submit('Queen');

    expect(useSearchStore.getState().recentSearches).toEqual(['Queen', 'Adele']);
  });

  it('submit deduplicates and moves to the front', () => {
    const store = useSearchStore.getState();
    store.submit('Adele');
    store.submit('Queen');
    store.submit('Adele');

    expect(useSearchStore.getState().recentSearches).toEqual(['Adele', 'Queen']);
  });

  it('submit ignores empty queries', () => {
    useSearchStore.getState().submit('   ');
    expect(useSearchStore.getState().recentSearches).toEqual([]);
  });

  it('caps the recent list size', () => {
    const store = useSearchStore.getState();
    for (let i = 0; i < MAX_RECENT_SEARCHES + 5; i += 1) {
      store.submit(`q${i}`);
    }

    const recent = useSearchStore.getState().recentSearches;
    expect(recent.length).toBe(MAX_RECENT_SEARCHES);
    expect(recent[0]).toBe(`q${MAX_RECENT_SEARCHES + 4}`);
  });

  it('removeRecent and clearRecent work', () => {
    const store = useSearchStore.getState();
    store.submit('Adele');
    store.submit('Queen');

    useSearchStore.getState().removeRecent('Adele');
    expect(useSearchStore.getState().recentSearches).toEqual(['Queen']);

    useSearchStore.getState().clearRecent();
    expect(useSearchStore.getState().recentSearches).toEqual([]);
  });

  it('setType switches the search scope', () => {
    useSearchStore.getState().setType('albums');
    expect(useSearchStore.getState().type).toBe('albums');
  });
});
