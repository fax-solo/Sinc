import { create } from 'zustand';
import type { CanonicalTrack } from '@sinc/shared';

export interface SongMenuContext {
  playlistId?: string;
  playlistName?: string;
  onRemoveFromPlaylist?: () => void;
  onRemoveFromHistory?: () => void;
  onRemoveFromQueue?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  sourceLabel?: string;
}

interface SongMenuState {
  track: CanonicalTrack | null;
  context: SongMenuContext;
  open: (track: CanonicalTrack, context?: SongMenuContext) => void;
  close: () => void;
}

export const useSongMenuStore = create<SongMenuState>()((set) => ({
  track: null,
  context: {},
  open: (track, context = {}) => set({ track, context }),
  close: () => set({ track: null, context: {} }),
}));

export function openSongMenu(track: CanonicalTrack, context?: SongMenuContext): void {
  useSongMenuStore.getState().open(track, context);
}
