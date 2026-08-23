/**
 * Fire-and-forget sync of listening signal (plays + favorites) to the server.
 * Personalization on the backend reads History + Favorite rows, so these calls
 * make the "Made for you" feed follow what the user actually plays/favorites.
 * All failures are swallowed: playback and toggling must never block on the
 * network.
 */
import type { CanonicalTrack } from '@sinc/shared';
import { musicApi } from '../../api/music';
import { useLibraryStore } from './libraryStore';
import { useAuthStore } from '../../features/auth/authStore';

let syncing = false;
let pending = false;

/** Uploads the current local favorites when signed in. Serializes rapid toggles. */
export function syncFavorites(): Promise<void> {
  return syncFavoritesAsync();
}

async function syncFavoritesAsync(): Promise<void> {
  if (syncing) {
    pending = true;
    return;
  }
  syncing = true;
  try {
    const { status } = useAuthStore.getState();
    if (status !== 'signedIn') return;
    const { favoriteTracks } = useLibraryStore.getState();
    await musicApi.syncFavorites(favoriteTracks);
  } catch {
    // Best-effort: the next toggle/visit will re-sync.
  } finally {
    syncing = false;
    if (pending) {
      pending = false;
      void syncFavoritesAsync();
    }
  }
}

/** Records a play to the server when signed in. Never blocks or throws. */
export function recordPlay(track: CanonicalTrack): void {
  const { status } = useAuthStore.getState();
  if (status !== 'signedIn') return;
  void musicApi.recordPlay(track).catch(() => {});
}

export interface CollectionPlay {
  id: string;
  type: 'mix' | 'album' | 'playlist';
  title: string;
  subtitle?: string;
  artworkUrl?: string;
}

/**
 * Records that the user started a collection (mix/album/playlist) so it shows
 * up in Home's "Recently played". Never blocks or throws.
 */
export function recordCollectionPlay(item: CollectionPlay): void {
  const { status } = useAuthStore.getState();
  if (status !== 'signedIn') return;
  void musicApi.recordCollectionPlay(item).catch(() => {});
}
