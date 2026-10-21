import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const ttls = new Map<string, number>();

class FakeRedis {
  constructor(url: string, _opts?: Record<string, unknown>) {
    this.url = url;
  }
  url = '';
  async get(key: string): Promise<string | null> {
    const ttlSec = ttls.get(key);
    if (ttlSec !== undefined && Date.now() - 1_000_000_000_000 > ttlSec * 1000) {
      store.delete(key);
      ttls.delete(key);
      return null;
    }
    return store.get(key) ?? null;
  }
  async setex(key: string, ttl: number, value: string): Promise<string> {
    store.set(key, value);
    ttls.set(key, ttl);
    return 'OK';
  }
  async del(key: string): Promise<number> {
    store.delete(key);
    ttls.delete(key);
    return 1;
  }
}

vi.mock('ioredis', () => ({ Redis: FakeRedis }));

const { createSearchCache } = await import('./search-cache.js');

describe('search-cache (redis path)', () => {
  beforeEach(() => {
    store.clear();
    ttls.clear();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores a ttl extended by the stale grace window', async () => {
    const cache = createSearchCache('redis://localhost:6379');
    await cache.set('k', { value: 1 }, 60);
    expect(ttls.get('k')).toBe(60 + 600);
  });

  it('get returns null once the value TTL elapses', async () => {
    const cache = createSearchCache('redis://localhost:6379');
    await cache.set('k', { value: 1 }, 60);
    vi.advanceTimersByTime(61_000);
    expect(await cache.get('k')).toBeNull();
  });

  it('get returns the value before expiry', async () => {
    const cache = createSearchCache('redis://localhost:6379');
    await cache.set('k', { value: 1 }, 60);
    expect(await cache.get('k')).toEqual({ value: 1 });
  });

  it('getStale returns the expired value during the grace window', async () => {
    const cache = createSearchCache('redis://localhost:6379');
    await cache.set('k', { value: 1 }, 60);
    vi.advanceTimersByTime(120_000);
    expect(await cache.get('k')).toBeNull();
    expect(await cache.getStale('k')).toEqual({ value: 1 });
  });

  it('getStale returns null once the physical (grace) TTL elapses', async () => {
    const cache = createSearchCache('redis://localhost:6379');
    await cache.set('k', { value: 1 }, 60);
    vi.advanceTimersByTime((60 + 600) * 1000 + 1_000);
    expect(await cache.getStale('k')).toBeNull();
  });

  it('getStale returns null for an unknown key', async () => {
    const cache = createSearchCache('redis://localhost:6379');
    expect(await cache.getStale('missing')).toBeNull();
  });

  it('set overwrites and delete removes', async () => {
    const cache = createSearchCache('redis://localhost:6379');
    await cache.set('k', { value: 1 }, 60);
    await cache.set('k', { value: 2 }, 60);
    expect(await cache.getStale('k')).toEqual({ value: 2 });
    await cache.delete('k');
    expect(await cache.get('k')).toBeNull();
  });

  it('degrades to in-memory when no URL is present', async () => {
    const cache = createSearchCache();
    await cache.set('k', { value: 1 }, 60);
    expect(await cache.get('k')).toEqual({ value: 1 });
  });
});
