/**
 * Artwork URL routing (local build). Artwork is loaded straight from the
 * third-party CDNs — no backend proxy. Non-http URIs (local files, bundled
 * assets) pass through untouched, and empty strings yield `undefined`.
 */
import { Image } from 'react-native';

export function artworkUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  return url;
}

/** Warms the native image cache for the first `count` artworks (no-ops on
 *  web). Fire-and-forget: failures are silently ignored. */
export function prefetchArtworks(urls: Array<string | null | undefined>, count = 10): void {
  let remaining = count;
  for (const url of urls) {
    if (remaining <= 0) break;
    const uri = artworkUrl(url);
    if (!uri || !/^https?:\/\//i.test(uri)) continue;
    remaining -= 1;
    void Image.prefetch(uri).catch(() => undefined);
  }
}
