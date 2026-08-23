/**
 * Lightweight disk cache (MMKV) for the slowest, largest reads — the home feed
 * and search results. The hooks seed react-query with this data so cold starts
 * and repeat visits render instantly (offline included) while the network
 * refreshes in the background. Search entries are LRU-capped to keep the
 * storage bounded.
 */
import { storage, STORAGE_KEYS } from '../utils/storage';
import type { HomeFeed, PersonalizedHomeFeed, SearchResults, SearchType } from './music';

const MAX_SEARCH_ENTRIES = 24;

interface CacheEntry<T> {
  at: number;
  data: T;
}

const indexKey = `${STORAGE_KEYS.SEARCH_CACHE}:index`;

function readIndex(): string[] {
  const raw = storage.getString(indexKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(index: string[]): void {
  storage.setString(indexKey, JSON.stringify(index));
}

function searchKey(query: string, type: SearchType): string {
  return `${STORAGE_KEYS.SEARCH_CACHE}:${type}:${query}`;
}

function read<T>(key: string): CacheEntry<T> | null {
  const raw = storage.getString(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed || typeof parsed.at !== 'number' || !('data' in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getCachedSearch(query: string, type: SearchType): CacheEntry<SearchResults> | null {
  return read<SearchResults>(searchKey(query, type));
}

export function setCachedSearch(query: string, type: SearchType, results: SearchResults): void {
  const key = searchKey(query, type);
  const entry: CacheEntry<SearchResults> = { at: Date.now(), data: results };
  storage.setString(key, JSON.stringify(entry));

  const index = readIndex();
  const next = [key, ...index.filter((k) => k !== key)].slice(0, MAX_SEARCH_ENTRIES);
  const evicted = index.filter((k) => !next.includes(k));
  for (const k of evicted) storage.remove(k);
  writeIndex(next);
}

export function getCachedHome(): CacheEntry<HomeFeed> | null {
  return read<HomeFeed>(STORAGE_KEYS.HOME_CACHE);
}

export function setCachedHome(feed: HomeFeed): void {
  const entry: CacheEntry<HomeFeed> = { at: Date.now(), data: feed };
  storage.setString(STORAGE_KEYS.HOME_CACHE, JSON.stringify(entry));
}

export function getCachedPersonalizedHome(userId: string): CacheEntry<PersonalizedHomeFeed> | null {
  return read<PersonalizedHomeFeed>(`${STORAGE_KEYS.PERSONALIZED_HOME_CACHE}:${userId}`);
}

export function setCachedPersonalizedHome(userId: string, feed: PersonalizedHomeFeed): void {
  const entry: CacheEntry<PersonalizedHomeFeed> = { at: Date.now(), data: feed };
  storage.setString(`${STORAGE_KEYS.PERSONALIZED_HOME_CACHE}:${userId}`, JSON.stringify(entry));
}
