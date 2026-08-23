import { beforeEach, describe, expect, it } from 'vitest';
import { storage } from '../utils/storage';
import { getCachedHome, getCachedSearch, setCachedHome, setCachedSearch } from './resultCache';
import type { HomeFeed } from './music';

function feed(): HomeFeed {
  return { popularTracks: [], newAlbums: [], topPlaylists: [], topArtists: [], starterMixes: [] };
}

beforeEach(() => {
  // In-memory storage fallback is used in tests; clear all keys between runs.
  storage.clear();
});

describe('resultCache', () => {
  it('round-trips search results with a timestamp', () => {
    setCachedSearch('bloodline', 'tracks', { tracks: { data: [], meta: {} } });
    const cached = getCachedSearch('bloodline', 'tracks');
    expect(cached).not.toBeNull();
    expect(cached?.data.tracks).toBeDefined();
    expect(typeof cached?.at).toBe('number');
  });

  it('returns null for an uncached search', () => {
    expect(getCachedSearch('never-searched', 'all')).toBeNull();
  });

  it('keeps search entries distinct per type', () => {
    setCachedSearch('bloodline', 'all', { tracks: { data: [], meta: {} } });
    setCachedSearch('bloodline', 'albums', { albums: { data: [], meta: {} } });
    expect(getCachedSearch('bloodline', 'all')?.data.tracks).toBeDefined();
    expect(getCachedSearch('bloodline', 'albums')?.data.albums).toBeDefined();
  });

  it('evicts the oldest search entries beyond the cap', () => {
    for (let i = 0; i < 30; i += 1) {
      setCachedSearch(`query-${i}`, 'all', { tracks: { data: [], meta: {} } });
    }
    expect(getCachedSearch('query-0', 'all')).toBeNull();
    expect(getCachedSearch('query-29', 'all')).not.toBeNull();
  });

  it('round-trips the home feed', () => {
    const home = { ...feed(), popularTracks: [] as never[] };
    setCachedHome(home);
    expect(getCachedHome()?.data).toEqual(home);
  });
});
