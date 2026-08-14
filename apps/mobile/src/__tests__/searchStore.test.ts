import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResponse } from '../api/music';

vi.mock('../storage', () => ({
  STORAGE_KEYS: {},
  storage: {
    getString: vi.fn(() => null),
    setString: vi.fn(),
    remove: vi.fn(),
  },
}));

const musicApiMock = {
  search: vi.fn(),
  suggest: vi.fn(),
};

vi.mock('../api/music', () => ({
  musicApi: musicApiMock,
}));

function buildTrack(
  id: string,
  title: string,
): {
  track: {
    id: string;
    title: string;
    normalizedTitle: string;
    durationMs: number;
    providerIds: Record<string, string>;
    providerConfidence: number;
    artists: { id: string; name: string }[];
  };
  score: number;
} {
  return {
    track: {
      id,
      title,
      normalizedTitle: title.toLowerCase(),
      durationMs: 200000,
      providerIds: { musicbrainz: id },
      providerConfidence: 0.9,
      artists: [{ id: `a-${id}`, name: 'Artist One' }],
    },
    score: 1,
  };
}

function buildResponse(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    tracks: {
      data: [buildTrack('t1', 'Song One')],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1, hasNext: false },
    },
    artists: { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false } },
    albums: { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false } },
    playlists: { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false } },
    ...overrides,
  };
}

describe('searchStore', () => {
  let store: (typeof import('../state/searchStore'))['useSearchStore'];
  let shared: typeof import('@sinc/shared');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.resetModules();
    shared = await import('@sinc/shared');
    const mod = await import('../state/searchStore');
    store = mod.useSearchStore;
    store.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('setQuery (debounced)', () => {
    it('debounces and runs a search after DEBOUNCE_MS', async () => {
      const response = buildResponse();
      musicApiMock.search.mockResolvedValue(response);
      musicApiMock.suggest.mockResolvedValue([]);

      store.getState().setQuery('cold');
      expect(musicApiMock.search).not.toHaveBeenCalled();
      expect(store.getState().status).toBe('idle');

      await vi.advanceTimersByTimeAsync(399);
      expect(musicApiMock.search).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(musicApiMock.search).toHaveBeenCalledWith({ q: 'cold', limit: 20 });

      await vi.runOnlyPendingTimersAsync();
      expect(store.getState().status).toBe('success');
      expect(store.getState().results?.tracks.data).toHaveLength(1);
      expect(store.getState().hasMore).toBe(false);
      expect(store.getState().total).toBe(1);
    });

    it('cancels the pending debounce on a new keystroke', async () => {
      const response = buildResponse();
      musicApiMock.search.mockResolvedValue(response);
      musicApiMock.suggest.mockResolvedValue([]);

      store.getState().setQuery('be');
      await vi.advanceTimersByTimeAsync(200);
      store.getState().setQuery('beyonce');
      await vi.advanceTimersByTimeAsync(200);
      expect(musicApiMock.search).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect(musicApiMock.search).toHaveBeenCalledTimes(1);
      expect(musicApiMock.search).toHaveBeenCalledWith({ q: 'beyonce', limit: 20 });
    });

    it('resets to idle when the query is cleared', async () => {
      store.getState().setQuery('x');
      await vi.advanceTimersByTimeAsync(500);
      await vi.runOnlyPendingTimersAsync();
      expect(store.getState().status).toBe('success');

      store.getState().setQuery('');
      expect(store.getState().status).toBe('idle');
      expect(store.getState().results).toBeNull();
      expect(store.getState().suggestions).toEqual([]);
    });

    it('fetches suggestions alongside results for queries >= SUGGEST_MIN_CHARS', async () => {
      musicApiMock.search.mockResolvedValue(buildResponse());
      musicApiMock.suggest.mockResolvedValue([{ type: 'artist', id: 'a1', text: 'Artist One' }]);

      store.getState().setQuery('ar');
      await vi.advanceTimersByTimeAsync(500);
      await vi.runOnlyPendingTimersAsync();

      expect(musicApiMock.suggest).toHaveBeenCalledWith('ar', 8);
      expect(store.getState().suggestions).toHaveLength(1);
    });

    it('skips suggestions for very short queries', async () => {
      musicApiMock.search.mockResolvedValue(buildResponse());
      musicApiMock.suggest.mockResolvedValue([]);

      store.getState().setQuery('a');
      await vi.advanceTimersByTimeAsync(500);
      await vi.runOnlyPendingTimersAsync();

      expect(musicApiMock.suggest).not.toHaveBeenCalled();
    });
  });

  describe('search (immediate submit)', () => {
    it('runs immediately and records the recent search', async () => {
      musicApiMock.search.mockResolvedValue(buildResponse());
      musicApiMock.suggest.mockResolvedValue([]);

      const promise = store.getState().search('gallery');
      expect(musicApiMock.search).toHaveBeenCalledTimes(1);
      expect(store.getState().recentSearches).toEqual(['gallery']);
      await promise;
      expect(store.getState().status).toBe('success');
    });

    it('does not record an empty query and does not search', async () => {
      await store.getState().search('   ');
      expect(musicApiMock.search).not.toHaveBeenCalled();
      expect(store.getState().recentSearches).toEqual([]);
    });

    it('moves a re-searched term to the front and dedupes', async () => {
      musicApiMock.search.mockResolvedValue(buildResponse());
      musicApiMock.suggest.mockResolvedValue([]);

      await store.getState().search('one');
      await store.getState().search('two');
      await store.getState().search('one');

      expect(store.getState().recentSearches).toEqual(['one', 'two']);
    });
  });

  describe('status handling', () => {
    it('maps SincError to error status with message key', async () => {
      musicApiMock.search.mockRejectedValue(
        new shared.SincError(shared.ErrorCodes.PROVIDER_ERROR, 'boom'),
      );
      musicApiMock.suggest.mockResolvedValue([]);

      await store.getState().search('boom');
      expect(store.getState().status).toBe('error');
      expect(store.getState().error).toBe('search.error');
    });

    it('maps rate-limit errors to the specific key', async () => {
      musicApiMock.search.mockRejectedValue(
        new shared.SincError(shared.ErrorCodes.RATE_LIMITED, 'slow down'),
      );
      musicApiMock.suggest.mockResolvedValue([]);

      await store.getState().search('boom');
      expect(store.getState().status).toBe('error');
      expect(store.getState().error).toBe('search.tooManyRequests');
    });

    it('maps OfflineError to offline status', async () => {
      musicApiMock.search.mockRejectedValue(new shared.OfflineError());
      musicApiMock.suggest.mockResolvedValue([]);

      await store.getState().search('offline');
      expect(store.getState().status).toBe('offline');
      expect(store.getState().error).toBeNull();
    });

    it('keeps previous results on a failed refresh', async () => {
      const response = buildResponse();
      musicApiMock.search
        .mockResolvedValueOnce(response)
        .mockRejectedValueOnce(new shared.OfflineError());
      musicApiMock.suggest.mockResolvedValue([]);

      await store.getState().search('ok');
      await store.getState().search('offline-now');
      expect(store.getState().status).toBe('offline');
      expect(store.getState().results?.tracks.data).toHaveLength(1);
    });
  });

  describe('type filter', () => {
    it('re-runs the search with the type param', async () => {
      const response = buildResponse();
      musicApiMock.search.mockResolvedValue(response);
      musicApiMock.suggest.mockResolvedValue([]);

      await store.getState().search('night');
      store.getState().setType('artists');
      expect(musicApiMock.search).toHaveBeenLastCalledWith({
        q: 'night',
        type: 'artists',
        limit: 20,
      });

      store.getState().setType('all');
      expect(musicApiMock.search).toHaveBeenLastCalledWith({ q: 'night', limit: 20 });
    });

    it('does not re-run when the type is unchanged', async () => {
      musicApiMock.search.mockResolvedValue(buildResponse());
      musicApiMock.suggest.mockResolvedValue([]);
      await store.getState().search('night');
      const calls = musicApiMock.search.mock.calls.length;
      store.getState().setType('all');
      expect(musicApiMock.search.mock.calls.length).toBe(calls);
    });
  });

  describe('pagination', () => {
    it('loads the next page and appends tracks without duplicates', async () => {
      const first = buildResponse({
        tracks: {
          data: [buildTrack('t1', 'One'), buildTrack('t2', 'Two')],
          meta: { page: 1, limit: 20, total: 3, totalPages: 2, hasNext: true },
        },
      });
      const second = buildResponse({
        tracks: {
          data: [buildTrack('t2', 'Two'), buildTrack('t3', 'Three')],
          meta: { page: 2, limit: 20, total: 3, totalPages: 2, hasNext: false },
        },
      });
      musicApiMock.search.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
      musicApiMock.suggest.mockResolvedValue([]);

      await store.getState().search('multi');
      await store.getState().loadMore();

      expect(musicApiMock.search).toHaveBeenLastCalledWith({ q: 'multi', page: 2, limit: 20 });
      expect(store.getState().page).toBe(2);
      expect(store.getState().results?.tracks.data.map((e) => e.track.id)).toEqual([
        't1',
        't2',
        't3',
      ]);
      expect(store.getState().hasMore).toBe(false);
      expect(store.getState().total).toBe(3);
    });

    it('ignores loadMore when there is no next page', async () => {
      musicApiMock.search.mockResolvedValue(buildResponse());
      musicApiMock.suggest.mockResolvedValue([]);

      await store.getState().search('single');
      await store.getState().loadMore();
      expect(musicApiMock.search.mock.calls.length).toBe(1);
    });

    it('sends the active type filter on the next page', async () => {
      const response = buildResponse({
        tracks: {
          data: [buildTrack('t1', 'One')],
          meta: { page: 1, limit: 20, total: 2, totalPages: 2, hasNext: true },
        },
      });
      musicApiMock.search.mockResolvedValue(response);
      musicApiMock.suggest.mockResolvedValue([]);

      await store.getState().search('filtered');
      store.getState().setType('albums');
      await vi.advanceTimersByTimeAsync(0);
      await store.getState().loadMore();
      expect(musicApiMock.search).toHaveBeenLastCalledWith({
        q: 'filtered',
        type: 'albums',
        page: 2,
        limit: 20,
      });
    });
  });

  describe('recent searches', () => {
    it('adds and removes entries', async () => {
      musicApiMock.search.mockResolvedValue(buildResponse());
      musicApiMock.suggest.mockResolvedValue([]);

      await store.getState().search('alpha');
      store.getState().removeRecent('alpha');
      expect(store.getState().recentSearches).toEqual([]);
    });

    it('clearRecent empties the list', async () => {
      musicApiMock.search.mockResolvedValue(buildResponse());
      musicApiMock.suggest.mockResolvedValue([]);

      await store.getState().search('alpha');
      await store.getState().search('beta');
      store.getState().clearRecent();
      expect(store.getState().recentSearches).toEqual([]);
    });

    it('caps recent searches at RECENT_MAX', async () => {
      musicApiMock.search.mockResolvedValue(buildResponse());
      musicApiMock.suggest.mockResolvedValue([]);

      for (let i = 0; i < 15; i++) {
        await store.getState().search(`term-${i}`);
      }
      expect(store.getState().recentSearches).toHaveLength(10);
      expect(store.getState().recentSearches[0]).toBe('term-14');
    });
  });

  describe('clear', () => {
    it('cancels the pending debounce and resets state', async () => {
      musicApiMock.search.mockResolvedValue(buildResponse());
      musicApiMock.suggest.mockResolvedValue([]);

      store.getState().setQuery('pending');
      store.getState().clear();
      await vi.advanceTimersByTimeAsync(1000);
      expect(musicApiMock.search).not.toHaveBeenCalled();
      expect(store.getState().status).toBe('idle');
    });
  });
});
