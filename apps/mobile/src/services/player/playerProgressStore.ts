/**
 * Transient playback progress. Kept separate from the persisted player store so
 * the 500ms native progress ticks never trigger a queue persist (JSON.stringify
 * + MMKV write on every set). Subscribers are limited to the seek bar and the
 * lyrics screen.
 */
import { create } from 'zustand';

interface PlayerProgressState {
  positionMs: number;
  durationMs: number;
  setProgress: (positionMs: number, durationMs: number) => void;
  reset: () => void;
}

export const usePlayerProgressStore = create<PlayerProgressState>()((set) => ({
  positionMs: 0,
  durationMs: 0,
  setProgress: (positionMs, durationMs) =>
    set((state) => {
      const next = { positionMs: Math.max(0, positionMs), durationMs: Math.max(0, durationMs) };
      return state.positionMs === next.positionMs && state.durationMs === next.durationMs
        ? state
        : next;
    }),
  reset: () => set({ positionMs: 0, durationMs: 0 }),
}));
