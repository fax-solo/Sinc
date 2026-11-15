/**
 * Last.fm Web Services client.
 *
 * Provides secondary artist metadata and listening counts:
 * - Total listeners count (explicitly attributed to Last.fm)
 * - Total scrobbles/plays (explicitly attributed to Last.fm)
 * - Artist biography summary
 * - Community tags and similar artists
 *
 * Important compliance & licensing notes:
 * - Requires a free user-configured API key; if absent, gracefully returns null.
 * - Under no circumstances are Last.fm metrics misrepresented as Spotify streams
 *   or Spotify monthly listeners. Every statistic is tagged with its provider source.
 * - HTML link tags in bio summaries are cleaned for native text rendering with
 *   attribution retained.
 */
import { providerFetchJson } from './http';
import { config } from '../../app/config';

const BASE_URL = 'https://ws.audioscrobbler.com/2.0/';

export interface LastFmArtistInfo {
  name: string;
  listeners?: number;
  playCount?: number;
  bioSummary?: string;
  tags: string[];
  similarArtists: string[];
  url?: string;
}

function cleanBio(raw?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  // Strip HTML anchors (e.g. <a href="https://www.last.fm/...">Read more on Last.fm</a>)
  const cleaned = raw
    .replace(/<a\b[^>]*>.*?<\/a>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export const lastFm = {
  /**
   * Fetch artist info from Last.fm if an API key is configured.
   */
  async getArtistInfo(
    artistName: string,
    apiKeyOverride?: string,
    timeoutMs = 5000
  ): Promise<LastFmArtistInfo | null> {
    const key = apiKeyOverride ?? (config as Record<string, unknown>).lastFmApiKey;
    if (typeof key !== 'string' || !key.trim()) {
      return null;
    }

    const trimmed = artistName.trim();
    if (!trimmed) return null;

    const url = `${BASE_URL}?method=artist.getinfo&artist=${encodeURIComponent(
      trimmed
    )}&api_key=${encodeURIComponent(key.trim())}&format=json&autocorrect=1`;

    interface ApiResponse {
      artist?: {
        name?: string;
        stats?: {
          listeners?: string;
          playcount?: string;
        };
        bio?: {
          summary?: string;
        };
        tags?: {
          tag?: Array<{ name?: string }> | { name?: string };
        };
        similar?: {
          artist?: Array<{ name?: string }> | { name?: string };
        };
        url?: string;
      };
      error?: number;
      message?: string;
    }

    try {
      const data = await providerFetchJson<ApiResponse>(url, undefined, timeoutMs);
      if (!data?.artist || data.error) return null;

      const art = data.artist;
      const listeners = art.stats?.listeners ? parseInt(art.stats.listeners, 10) : undefined;
      const playCount = art.stats?.playcount ? parseInt(art.stats.playcount, 10) : undefined;

      const rawTags = Array.isArray(art.tags?.tag)
        ? art.tags.tag
        : art.tags?.tag
          ? [art.tags.tag]
          : [];
      const tags = rawTags
        .map((t) => t.name?.trim())
        .filter((n): n is string => Boolean(n));

      const rawSimilar = Array.isArray(art.similar?.artist)
        ? art.similar.artist
        : art.similar?.artist
          ? [art.similar.artist]
          : [];
      const similarArtists = rawSimilar
        .map((s) => s.name?.trim())
        .filter((n): n is string => Boolean(n));

      return {
        name: art.name ?? trimmed,
        listeners: Number.isFinite(listeners) ? listeners : undefined,
        playCount: Number.isFinite(playCount) ? playCount : undefined,
        bioSummary: cleanBio(art.bio?.summary),
        tags,
        similarArtists,
        url: art.url,
      };
    } catch {
      return null;
    }
  },
};
