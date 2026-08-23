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
  setStatus: (status: PlaybackStatus) => void;
  setError: (message: string | null) => void;
  next: () => void;
  previous: () => void;
  toggleShuffle: () => void;
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
        usePlayerProgressStore.getState().reset();
        set({
          queue: tracks,
          currentIndex: safeIndex,
          status: 'loading',
          errorMessage: null,
        });
      },

      playTrack: (track) => {
        usePlayerProgressStore.getState().reset();
        set({
          queue: [track],
          currentIndex: 0,
          status: 'loading',
          errorMessage: null,
        });
      },

      setStatus: (status) => set({ status }),

      setError: (errorMessage) => set({ errorMessage }),

      next: () => {
        const { queue, currentIndex, repeat, shuffle } = get();
        if (queue.length === 0) return;

        let nextIndex: number;
        if (shuffle === 'on') {
          if (queue.length === 1) {
            nextIndex = currentIndex;
          } else {
            do {
              nextIndex = Math.floor(Math.random() * queue.length);
            } while (nextIndex === currentIndex);
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
        const { queue, currentIndex } = get();
        if (queue.length === 0) return;
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : 0;
        usePlayerProgressStore.getState().reset();
        set({
          currentIndex: prevIndex,
          status: 'loading',
        });
      },

      toggleShuffle: () => set({ shuffle: get().shuffle === 'on' ? 'off' : 'on' }),

      setRepeat: (repeat) => set({ repeat }),

      clearQueue: () => {
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
