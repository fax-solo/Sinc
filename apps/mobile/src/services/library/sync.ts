/**
 * Local recording of listening signals (plays + favorites). There is no backend
 * in the local build: plays are written straight into the on-device library so
 * "Recently played" and the local home feed follow what the user actually
 * plays. These helpers never block or throw.
 */
import type { CanonicalTrack } from '@sinc/shared';
import { useLibraryStore } from './libraryStore';

/** Local favorites already live in the library store; nothing to upload. */
export function syncFavorites(): Promise<void> {
  return Promise.resolve();
}

/** Records a play against the local library (moves it to "Recently played"). */
export function recordPlay(track: CanonicalTrack): void {
  useLibraryStore.getState().recordPlayed(track);
}

export interface CollectionPlay {
  id: string;
  type: 'mix' | 'album' | 'playlist';
  title: string;
  subtitle?: string;
  artworkUrl?: string;
}

/**
 * Records that the user started a collection so it shows up in Home's
 * "Recently played playlists". Playlists are surfaced from local state.
 */
export function recordCollectionPlay(item: CollectionPlay): void {
  if (item.type === 'playlist') {
    useLibraryStore.getState().recordPlaylistPlayed(item.id);
  }
}
