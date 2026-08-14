import { describe, it, expect, vi } from 'vitest';
import { SearchCacheService, SingleFlight, searchKey } from '../persistence/search-cache.js';

describe('searchKey', () => {
  it('normalizes the query and scopes by kind', () => {
    expect(searchKey('search', '  Hotel  ')).toBe('music:search:hotel');
    expect(searchKey('suggest', 'Hotel', 'l=8')).toBe('music:suggest:l=8:hotel');
    expect(searchKey('search', 'Hotel', 'type=songs')).toBe('music:search:type=songs:hotel');
  });

  it('case-insensitive and filter-aware', () => {
    expect(searchKey('search', 'HOTEL')).toBe(searchKey('search', 'hotel'));
    expect(searchKey('search', 'hotel', 'a')).not.toBe(searchKey('search', 'hotel', 'b'));
  });
});

describe('SearchCacheService (in-memory)', () => {
  it('round-trips values', async () => {
    const cache = new SearchCacheService(null);
    await cache.set('k', { tracks: [1, 2] }, 60);
    await expect(cache.get('k')).resolves.toEqual({ tracks: [1, 2] });
  });

  it('expires entries after their TTL', async () => {
    let now = 1_000;
    const cache = new SearchCacheService(null, () => now);
    await cache.set('k', 'v', 10);
    now = 11_001;
    await expect(cache.get('k')).resolves.toBeNull();
  });

  it('returns null for missing keys', async () => {
    const cache = new SearchCacheService(null);
    await expect(cache.get('missing')).resolves.toBeNull();
  });

  it('never throws on failures (degraded to miss)', async () => {
    const cache = new SearchCacheService(null);
    await cache.set('k', { circular: undefined }, 10);
    await expect(cache.get('k')).resolves.not.toBeUndefined();
    const corrupted = new SearchCacheService(null);
    (corrupted as unknown as { memory: Map<string, { value: string }> }).memory.set('bad', {
      value: '{',
    });
    await expect(corrupted.get('bad')).resolves.toBeNull();
  });

  it('resetForTest clears entries', async () => {
    const cache = new SearchCacheService(null);
    await cache.set('k', 'v', 60);
    cache.resetForTest();
    await expect(cache.get('k')).resolves.toBeNull();
  });
});

describe('SearchCacheService (redis)', () => {
  function fakeRedis() {
    const store = new Map<string, string>();
    return {
      store,
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string, _mode: string, _ttl: number) => {
        store.set(key, value);
        return 'OK';
      }),
    };
  }

  it('uses SETEX-style JSON writes and reads', async () => {
    const redis = fakeRedis();
    const cache = new SearchCacheService(redis as never);
    await cache.set('k', { hello: 'world' }, 120);
    expect(redis.set).toHaveBeenCalledWith('k', JSON.stringify({ hello: 'world' }), 'EX', 120);
    await expect(cache.get('k')).resolves.toEqual({ hello: 'world' });
  });

  it('treats redis errors as misses', async () => {
    const redis = {
      get: vi.fn(async () => {
        throw new Error('connection refused');
      }),
      set: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    } as never;
    const cache = new SearchCacheService(redis as never);
    await expect(cache.get('k')).resolves.toBeNull();
    await expect(cache.set('k', 'v', 60)).resolves.toBeUndefined();
  });
});

describe('SingleFlight', () => {
  it('shares one promise for identical in-flight keys', async () => {
    const flight = new SingleFlight();
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return calls;
    });

    const [a, b, c] = await Promise.all([
      flight.run('key', fn),
      flight.run('key', fn),
      flight.run('key', fn),
    ]);
    expect([a, b, c]).toEqual([1, 1, 1]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(flight.size()).toBe(0);
  });

  it('runs distinct keys independently', async () => {
    const flight = new SingleFlight();
    const fn = vi.fn(async (label: string) => label);
    const [a, b] = await Promise.all([
      flight.run('a', () => fn('a')),
      flight.run('b', () => fn('b')),
    ]);
    expect([a, b]).toEqual(['a', 'b']);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clears the entry after failure so retries are possible', async () => {
    const flight = new SingleFlight();
    const fn = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(flight.run('k', fn)).rejects.toThrow('boom');
    await expect(flight.run('k', fn)).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
