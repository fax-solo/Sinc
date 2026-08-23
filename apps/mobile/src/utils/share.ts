/**
 * Share-link helpers (M7.1). The public link space mirrors the app's
 * deep-link routes (see app/navigation/linking.ts), so a shared link opens
 * straight into the matching screen when tapped on a device with the app
 * installed, or falls back to the server host when opened in a browser.
 */
import { Share } from 'react-native';

export type ShareableType = 'song' | 'album' | 'artist' | 'playlist' | 'mix';

/** The public host for shareable links (also the app-link domain). */
export const SHARE_HOST = 'https://sinc.app';

/** Builds a deep link for an entity, e.g. `https://sinc.app/album/123`. */
export function buildShareLink(type: ShareableType, id: string): string {
  const safe = encodeURIComponent(id);
  return `${SHARE_HOST}/${type}/${safe}`;
}

export interface ShareEntity {
  type: ShareableType;
  id: string;
  title: string;
  subtitle?: string;
}

/**
 * Opens the native share sheet with a Sinc link for the given entity.
 * Resolves to false when the user dismisses the sheet without sharing.
 */
export async function shareEntity(entity: ShareEntity): Promise<boolean> {
  const url = buildShareLink(entity.type, entity.id);
  const message = entity.subtitle
    ? `${entity.title} — ${entity.subtitle}\n${url}`
    : `${entity.title}\n${url}`;
  const result = await Share.share({ message, url });
  return result.action === Share.sharedAction;
}
