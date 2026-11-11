import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CanonicalTrack } from '@sinc/shared';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { usePlayerProgressStore } from './playerProgressStore';

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export type RepeatMode = 'off' | 'one' | 'all';
export type ShuffleMode = 'off' | 'on';

interface PlayerState {
  status: PlaybackStatus;
  queue: CanonicalTrack[];
  currentIndex: number;
  shuffle: ShuffleMode;
  repeat: RepeatMode;
  errorMessage: string | null;

  playQueue: (tracks: CanonicalTrack[], startIndex?: number) => void;
  playTrack: (track: CanonicalTrack) => void;
  /** Appends one track. Duplicate ids already in the queue are ignored. */
  addToQueue: (track: CanonicalTrack) => boolean;
  /** Appends a collection, de-duplicating against the queue. Returns count added. */
  addTracksToQueue: (tracks: CanonicalTrack[]) => number;
  /** Inserts immediately after the current track. */
  playNext: (track: CanonicalTrack) => boolean;
  /** Jumps to an absolute queue index without replacing the queue. */
  jumpTo: (index: number) => boolean;
  /** Removes an upcoming track. The current track can never be removed. */
  removeFromQueue: (index: number) => boolean;
  /** Reorders two upcoming tracks. The current track never moves. */
  reorderQueue: (fromIndex: number, toIndex: number) => boolean;
  setStatus: (status: PlaybackStatus) => void;
  setError: (message: string | null) => void;
  next: () => void;
  previous: () => void;
  toggleShuffle: () => void;
  setShuffle: (shuffle: ShuffleMode) => void;
  setRepeat: (repeat: RepeatMode) => void;
  clearQueue: () => void;
}

/** Selector for the track that should currently be playing. */
export function selectCurrentTrack(
  state: Pick<PlayerState, 'queue' | 'currentIndex'>
): CanonicalTrack | null {
  return state.queue[state.currentIndex] ?? null;
}

function emptyState(): Pick<
  PlayerState,
  'status' | 'queue' | 'currentIndex' | 'shuffle' | 'repeat' | 'errorMessage'
> {
  return {
    status: 'idle',
    queue: [],
    currentIndex: -1,
    shuffle: 'off',
    repeat: 'off',
    errorMessage: null,
  };
}

/**
 * Absolute indices visited in the current shuffle cycle. Kept outside the
 * persisted store because it is playback-session state; losing it only means
 * a fresh shuffle cycle after a restart. Tracking it makes repeat=off stop
 * after every track has played instead of shuffling forever.
 */
let shuffleHistory: number[] = [];

function resetShuffleHistory(currentIndex: number): void {
  shuffleHistory = currentIndex >= 0 ? [currentIndex] : [];
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      status: 'idle',
      queue: [],
      currentIndex: -1,
      shuffle: 'off',
      repeat: 'off',
      errorMessage: null,

      playQueue: (tracks, startIndex = 0) => {
        if (tracks.length === 0) {
          set(emptyState());
          usePlayerProgressStore.getState().reset();
          return;
        }
        const safeIndex = Math.min(Math.max(0, startIndex), tracks.length - 1);
        resetShuffleHistory(safeIndex);
        usePlayerProgressStore.getState().reset();
        set({
          queue: tracks,
          currentIndex: safeIndex,
          status: 'loading',
          errorMessage: null,
        });
      },

      playTrack: (track) => {
        resetShuffleHistory(0);
        usePlayerProgressStore.getState().reset();
        set({
          queue: [track],
          currentIndex: 0,
          status: 'loading',
          errorMessage: null,
        });
      },

      addToQueue: (track) => {
        const { queue, currentIndex } = get();
        if (queue.some((t) => t.id === track.id)) return false;
        if (queue.length === 0) {
          usePlayerProgressStore.getState().reset();
          set({
            queue: [track],
            currentIndex: 0,
            status: 'loading',
            errorMessage: null,
          });
          return true;
        }
        set({
          queue: [...queue, track],
          currentIndex: currentIndex < 0 ? 0 : currentIndex,
        });
        return true;
      },

      addTracksToQueue: (tracks) => {
        const { queue, currentIndex } = get();
        const seen = new Set(queue.map((t) => t.id));
        const additions: CanonicalTrack[] = [];
        for (const track of tracks) {
          if (seen.has(track.id)) continue;
          seen.add(track.id);
          additions.push(track);
        }
        if (additions.length === 0) return 0;
        if (queue.length === 0) {
          usePlayerProgressStore.getState().reset();
          set({
            queue: additions,
            currentIndex: 0,
            status: 'loading',
            errorMessage: null,
          });
          return additions.length;
        }
        set({
          queue: [...queue, ...additions],
          currentIndex: currentIndex < 0 ? 0 : currentIndex,
        });
        return additions.length;
      },

      playNext: (track) => {
        const { queue, currentIndex } = get();
        if (queue.length === 0) {
          usePlayerProgressStore.getState().reset();
          set({
            queue: [track],
            currentIndex: 0,
            status: 'loading',
            errorMessage: null,
          });
          return true;
        }
        const current = queue[currentIndex];
        if (current?.id === track.id) return false;
        if (queue.some((t, index) => index > currentIndex && t.id === track.id)) return false;
        const insertAt = Math.max(0, currentIndex + 1);
        const next = [...queue];
        next.splice(insertAt, 0, track);
        set({ queue: next });
        return true;
      },

      jumpTo: (index) => {
        const { queue } = get();
        if (index < 0 || index >= queue.length) return false;
        resetShuffleHistory(index);
        usePlayerProgressStore.getState().reset();
        set({ currentIndex: index, status: 'loading', errorMessage: null });
        return true;
      },

      removeFromQueue: (index) => {
        const { queue, currentIndex } = get();
        if (index <= currentIndex || index >= queue.length) return false;
        resetShuffleHistory(currentIndex);
        set({ queue: queue.filter((_, i) => i !== index) });
        return true;
      },

      reorderQueue: (fromIndex, toIndex) => {
        const { queue, currentIndex } = get();
        if (
          fromIndex <= currentIndex ||
          toIndex <= currentIndex ||
          fromIndex >= queue.length ||
          toIndex >= queue.length ||
          fromIndex === toIndex
        ) {
          return false;
        }
        const next = [...queue];
        const [moved] = next.splice(fromIndex, 1);
        if (!moved) return false;
        next.splice(toIndex, 0, moved);
        resetShuffleHistory(currentIndex);
        set({ queue: next });
        return true;
      },

      setStatus: (status) => set({ status }),

      setError: (errorMessage) => set({ errorMessage }),

      next: () => {
        const { queue, currentIndex, repeat, shuffle } = get();
        if (queue.length === 0) return;

        let nextIndex: number;
        if (shuffle === 'on') {
          if (queue.length === 1) {
            if (repeat === 'off') {
              set({ status: 'ended' });
              return;
            }
            nextIndex = currentIndex;
          } else {
            if (shuffleHistory[shuffleHistory.length - 1] !== currentIndex) {
              shuffleHistory.push(currentIndex);
            }
            const all = queue.map((_, index) => index);
            let candidates = all.filter((index) => !shuffleHistory.includes(index));
            if (candidates.length === 0) {
              if (repeat === 'off') {
                set({ status: 'ended' });
                return;
              }
              // Repeat all (or a manual next under repeat one) begins a new
              // shuffle cycle, excluding the current track.
              shuffleHistory = [currentIndex];
              candidates = all.filter((index) => index !== currentIndex);
            }
            nextIndex =
              candidates[Math.floor(Math.random() * candidates.length)] ?? currentIndex;
            shuffleHistory.push(nextIndex);
          }
        } else {
          nextIndex = currentIndex + 1;
          if (nextIndex >= queue.length) {
            if (repeat === 'all' || repeat === 'one') {
              nextIndex = 0;
            } else {
              set({ status: 'ended' });
              return;
            }
          }
        }

        usePlayerProgressStore.getState().reset();
        set({
          currentIndex: nextIndex,
          status: 'loading',
        });
      },

      previous: () => {
        const { queue, currentIndex, shuffle } = get();
        if (queue.length === 0) return;
        let prevIndex = currentIndex > 0 ? currentIndex - 1 : 0;
        if (shuffle === 'on' && shuffleHistory.length > 1) {
          const position = shuffleHistory.lastIndexOf(currentIndex);
          if (position > 0) {
            prevIndex = shuffleHistory[position - 1];
            shuffleHistory = shuffleHistory.slice(0, position);
          } else {
            resetShuffleHistory(prevIndex);
          }
        } else {
          resetShuffleHistory(prevIndex);
        }
        usePlayerProgressStore.getState().reset();
        set({
          currentIndex: prevIndex,
          status: 'loading',
        });
      },

      toggleShuffle: () => {
        const shuffle = get().shuffle === 'on' ? 'off' : 'on';
        resetShuffleHistory(get().currentIndex);
        set({ shuffle });
      },

      setShuffle: (shuffle) => {
        resetShuffleHistory(get().currentIndex);
        set({ shuffle });
      },

      setRepeat: (repeat) => set({ repeat }),

      clearQueue: () => {
        resetShuffleHistory(-1);
        usePlayerProgressStore.getState().reset();
        set(emptyState());
      },
    }),
    {
      name: STORAGE_KEYS.PLAYER,
      storage: createJSONStorage(() => ({
        getItem: (key) => storage.getString(key),
        setItem: (key, value) => storage.setString(key, value),
        removeItem: (key) => storage.remove(key),
      })),
      partialize: (state) => ({
        queue: state.queue,
        currentIndex: state.currentIndex,
        shuffle: state.shuffle,
        repeat: state.repeat,
      }),
    }
  )
);
