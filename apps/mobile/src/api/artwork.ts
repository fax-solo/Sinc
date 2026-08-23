/**
 * Artwork URL routing. Remote cover images are served through the backend's
 * `/music/artwork` proxy so the device HTTP cache sees one stable origin with
 * long-lived Cache-Control, and image prefetching doesn't fan out to many
 * third-party CDNs. Non-http URIs (local files, bundled assets) pass through.
 */
import { Image } from 'react-native';

import { config } from '../app/config';

export function artworkUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (!/^https?:\/\//i.test(url)) return url;
  return `${config.apiBaseUrl}/music/artwork?u=${encodeURIComponent(url)}`;
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
