/**
 * Spotify URL validation, normalization, and public oEmbed integration.
 *
 * Requirements:
 * - Operates without Spotify Client ID, Client Secret, or Spotify authentication.
 * - Legitimate open.spotify.com / spotify:* URI parsing.
 * - Public oEmbed metadata retrieval without scraping or private endpoints.
 * - Deep linking to open native Spotify app or web player.
 */
import { Linking } from 'react-native';
import type { SpotifyUrlInfo, SpotifyUrlType } from '@sinc/shared';
import { providerFetchJson } from './http';

const SPOTIFY_URL_RE =
  /(?:https?:\/\/)?(?:open\.)?spotify\.com\/(?:embed\/)?(track|album|artist|playlist)\/([A-Za-z0-9]{22})(?:\?[^\s]*)?/i;
const SPOTIFY_URI_RE = /^spotify:(track|album|artist|playlist):([A-Za-z0-9]{22})$/i;

export interface SpotifyOembedResult {
  title: string;
  authorName?: string;
  authorUrl?: string;
  thumbnailUrl?: string;
  type?: string;
  html?: string;
}

export function parseSpotifyUrl(input: string): SpotifyUrlInfo | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const uriMatch = trimmed.match(SPOTIFY_URI_RE);
  if (uriMatch && uriMatch[1] && uriMatch[2]) {
    const type = uriMatch[1].toLowerCase() as SpotifyUrlType;
    const id = uriMatch[2];
    return {
      type,
      id,
      url: `https://open.spotify.com/${type}/${id}`,
    };
  }

  const urlMatch = trimmed.match(SPOTIFY_URL_RE);
  if (urlMatch && urlMatch[1] && urlMatch[2]) {
    const type = urlMatch[1].toLowerCase() as SpotifyUrlType;
    const id = urlMatch[2];
    return {
      type,
      id,
      url: `https://open.spotify.com/${type}/${id}`,
    };
  }

  return null;
}

export function isSpotifyPlaylistUrl(input: string): boolean {
  const parsed = parseSpotifyUrl(input);
  return parsed?.type === 'playlist';
}

export async function fetchSpotifyOembed(url: string, timeoutMs = 5000): Promise<SpotifyOembedResult | null> {
  const parsed = parseSpotifyUrl(url);
  if (!parsed) return null;

  const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(parsed.url)}`;

  interface OembedResponse {
    title?: string;
    author_name?: string;
    author_url?: string;
    thumbnail_url?: string;
    type?: string;
    html?: string;
  }

  try {
    const data = await providerFetchJson<OembedResponse>(oembedUrl, undefined, timeoutMs);
    if (!data?.title) return null;

    return {
      title: data.title,
      authorName: data.author_name,
      authorUrl: data.author_url,
      thumbnailUrl: data.thumbnail_url,
      type: data.type,
      html: data.html,
    };
  } catch {
    return null;
  }
}

export async function openSpotifyUrl(url: string): Promise<boolean> {
  const parsed = parseSpotifyUrl(url);
  if (!parsed) return false;

  // Try spotify: native protocol first, fallback to https: web URL
  const nativeUri = `spotify:${parsed.type}:${parsed.id}`;
  try {
    const canOpenNative = await Linking.canOpenURL(nativeUri);
    if (canOpenNative) {
      await Linking.openURL(nativeUri);
      return true;
    }
  } catch {
    // native protocol unavailable
  }

  try {
    await Linking.openURL(parsed.url);
    return true;
  } catch {
    return false;
  }
}
