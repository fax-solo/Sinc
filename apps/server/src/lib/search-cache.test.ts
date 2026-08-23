import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSearchCache } from './search-cache.js';

const FIVE_MIN_MS = 300_000;

describe('search-cache (in-memory fallback)', () => {
  let cache: ReturnType<typeof createSearchCache>;

  beforeEach(() => {
    cache = createSearchCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('get returns null after expiry', async () => {
    vi.useFakeTimers();
    await cache.set('k', { value: 1 }, 1);
    vi.advanceTimersByTime(2_000);
    expect(await cache.get('k')).toBeNull();
  });

  it('getStale still returns the expired entry', async () => {
    vi.useFakeTimers();
    await cache.set('k', { value: 1 }, 1);
    vi.advanceTimersByTime(FIVE_MIN_MS);
    expect(await cache.get('k')).toBeNull();
    expect(await cache.getStale('k')).toEqual({ value: 1 });
  });

  it('getStale returns null for an unknown key', async () => {
    expect(await cache.getStale('missing')).toBeNull();
  });

  it('set overwrites and getStale reflects the new value', async () => {
    await cache.set('k', { value: 1 }, 60);
    await cache.set('k', { value: 2 }, 60);
    expect(await cache.getStale('k')).toEqual({ value: 2 });
  });
});
