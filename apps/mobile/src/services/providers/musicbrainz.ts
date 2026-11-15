/**
 * MusicBrainz API (WS/2) client.
 *
 * Provides open, community-curated artist metadata:
 * - Authoritative MBID and artist aliases
 * - Country/origin and life-span
 * - Verified external links (Spotify, Deezer, Wikidata, Discogs, Last.fm, Homepage)
 * - Release groups (albums, singles, EPs, compilations)
 *
 * In compliance with MusicBrainz API usage guidelines:
 * - Rate limited to <= 1 request/second via an internal sequential queue.
 * - Stamped with a custom User-Agent identifying Sinc and its repository.
 */
import { providerFetchJson } from './http';
import type { ExternalLinks } from '@sinc/shared';

const BASE_URL = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'Sinc/1.0.0 ( https://github.com/fax-solo/Sinc )';
const RATE_LIMIT_DELAY_MS = 1050; // MusicBrainz strictly enforces 1 req/sec

export interface MusicBrainzArtist {
  id: string;
  name: string;
  sortName?: string;
  type?: string;
  country?: string;
  area?: { name?: string };
  disambiguation?: string;
  lifeSpan?: { begin?: string; end?: string; ended?: boolean };
  genres?: string[];
  aliases?: string[];
  externalLinks: ExternalLinks;
}

export interface MusicBrainzReleaseGroup {
  id: string;
  title: string;
  primaryType?: string; // 'Album' | 'Single' | 'EP' | 'Other'
  secondaryTypes?: string[]; // e.g. ['Compilation', 'Live']
  firstReleaseDate?: string;
}

// Queue to enforce <= 1 request per second
let lastRequestTime = 0;
let queuePromise: Promise<unknown> = Promise.resolve();

async function rateLimitedFetch<T>(url: string, timeoutMs = 6000): Promise<T | null> {
  const execute = async (): Promise<T | null> => {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < RATE_LIMIT_DELAY_MS) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS - elapsed));
    }
    lastRequestTime = Date.now();

    try {
      return await providerFetchJson<T>(
        url,
        {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
          },
        },
        timeoutMs
      );
    } catch {
      return null;
    }
  };

  const next = queuePromise.then(execute, execute);
  queuePromise = next;
  return next;
}

function parseExternalLinks(relations?: Array<{ type?: string; url?: { resource?: string } }>): ExternalLinks {
  const links: ExternalLinks = {};
  if (!Array.isArray(relations)) return links;

  for (const rel of relations) {
    const resource = rel.url?.resource;
    if (!resource || typeof resource !== 'string') continue;
    const lowerType = (rel.type ?? '').toLowerCase();
    const lowerUrl = resource.toLowerCase();

    if (lowerType === 'spotify' || lowerUrl.includes('open.spotify.com/artist/')) {
      links.spotify = resource;
    } else if (lowerType === 'deezer' || lowerUrl.includes('deezer.com/artist/')) {
      links.deezer = resource;
    } else if (lowerType === 'wikidata' || lowerUrl.includes('wikidata.org/wiki/')) {
      links.wikidata = resource;
    } else if (lowerType === 'discogs' || lowerUrl.includes('discogs.com/artist/')) {
      links.discogs = resource;
    } else if (lowerType === 'last.fm' || lowerUrl.includes('last.fm/music/')) {
      links.lastfm = resource;
    } else if (lowerType === 'official homepage' && !links.homepage) {
      links.homepage = resource;
    }
  }

  return links;
}

export const musicBrainz = {
  /**
   * Search for an artist by name.
   */
  async searchArtist(name: string, limit = 5): Promise<MusicBrainzArtist[]> {
    const trimmed = name.trim();
    if (!trimmed) return [];

    const url = `${BASE_URL}/artist/?query=artist:${encodeURIComponent(trimmed)}&limit=${limit}&fmt=json`;
    interface SearchResponse {
      artists?: Array<{
        id: string;
        name: string;
        'sort-name'?: string;
        type?: string;
        country?: string;
        area?: { name?: string };
        disambiguation?: string;
        'life-span'?: { begin?: string; end?: string; ended?: boolean };
        tags?: Array<{ name?: string; count?: number }>;
        aliases?: Array<{ name?: string }>;
      }>;
    }

    const data = await rateLimitedFetch<SearchResponse>(url);
    if (!data?.artists || !Array.isArray(data.artists)) return [];

    return data.artists.map((a) => ({
      id: a.id,
      name: a.name,
      sortName: a['sort-name'],
      type: a.type,
      country: a.country ?? a.area?.name,
      area: a.area,
      disambiguation: a.disambiguation,
      lifeSpan: a['life-span'],
      genres: (a.tags ?? []).map((t) => t.name).filter((n): n is string => Boolean(n)),
      aliases: (a.aliases ?? []).map((al) => al.name).filter((n): n is string => Boolean(n)),
      externalLinks: { musicbrainz: `https://musicbrainz.org/artist/${a.id}` },
    }));
  },

  /**
   * Lookup artist with external relationships, genres, life-span, and aliases.
   */
  async lookupArtist(mbid: string): Promise<MusicBrainzArtist | null> {
    const trimmed = mbid.trim();
    if (!trimmed) return null;

    const url = `${BASE_URL}/artist/${encodeURIComponent(
      trimmed
    )}?inc=url-rels+tags+genres+aliases&fmt=json`;

    interface LookupResponse {
      id: string;
      name: string;
      'sort-name'?: string;
      type?: string;
      country?: string;
      area?: { name?: string };
      disambiguation?: string;
      'life-span'?: { begin?: string; end?: string; ended?: boolean };
      genres?: Array<{ name?: string }>;
      tags?: Array<{ name?: string }>;
      aliases?: Array<{ name?: string }>;
      relations?: Array<{ type?: string; url?: { resource?: string } }>;
    }

    const data = await rateLimitedFetch<LookupResponse>(url);
    if (!data?.id) return null;

    const extLinks = parseExternalLinks(data.relations);
    extLinks.musicbrainz = `https://musicbrainz.org/artist/${data.id}`;

    const combinedGenres = [
      ...(data.genres ?? []).map((g) => g.name),
      ...(data.tags ?? []).map((t) => t.name),
    ].filter((n): n is string => Boolean(n));

    return {
      id: data.id,
      name: data.name,
      sortName: data['sort-name'],
      type: data.type,
      country: data.country ?? data.area?.name,
      area: data.area,
      disambiguation: data.disambiguation,
      lifeSpan: data['life-span'],
      genres: Array.from(new Set(combinedGenres)),
      aliases: (data.aliases ?? []).map((al) => al.name).filter((n): n is string => Boolean(n)),
      externalLinks: extLinks,
    };
  },

  /**
   * Lookup artist discography release groups.
   */
  async lookupReleaseGroups(mbid: string): Promise<MusicBrainzReleaseGroup[]> {
    const trimmed = mbid.trim();
    if (!trimmed) return [];

    const url = `${BASE_URL}/release-group?artist=${encodeURIComponent(trimmed)}&limit=100&fmt=json`;

    interface ReleaseGroupResponse {
      'release-groups'?: Array<{
        id: string;
        title: string;
        'primary-type'?: string;
        'secondary-types'?: string[];
        'first-release-date'?: string;
      }>;
    }

    const data = await rateLimitedFetch<ReleaseGroupResponse>(url);
    if (!data?.['release-groups'] || !Array.isArray(data['release-groups'])) return [];

    return data['release-groups'].map((rg) => ({
      id: rg.id,
      title: rg.title,
      primaryType: rg['primary-type'],
      secondaryTypes: rg['secondary-types'],
      firstReleaseDate: rg['first-release-date'],
    }));
  },
};
