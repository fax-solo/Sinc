import { create } from 'zustand';
import {
  PlaybackState,
  PlaybackStateMachine,
  type RepeatMode,
  type ShuffleMode,
} from '@sinc/shared';
import { storage, STORAGE_KEYS } from '../storage';
import { createAudioEngine } from '../audio/engine';
import { musicApi } from '../api/music';
import { getDatabase } from '../db/database';
import { completedDownloadUri } from '../db/downloads';

/** Returns the on-device file for a completed download, if any. */
async function completedLocalUri(trackId: string): Promise<string | null> {
  try {
    return await completedDownloadUri(getDatabase(), trackId);
  } catch {
    return null;
  }
}

const PLAYER_STORAGE_KEY = STORAGE_KEYS.PLAYER;

export interface QueueEntry {
  trackId: string;
  source: 'LOCAL' | 'REMOTE' | 'CACHED';
  title?: string;
  artist?: string;
}

export interface TrackMeta {
  title: string;
  artist?: string;
  albumTitle?: string;
  artworkUrl?: string;
}

interface PersistedPlayerState {
  queue: QueueEntry[];
  queueIndex: number;
  currentTrackId: string | null;
}

interface PlaybackStateValue {
  status: PlaybackState;
  currentTrackId: string | null;
  queue: QueueEntry[];
  queueIndex: number;
  positionMs: number;
  durationMs: number;
  shuffle: ShuffleMode;
  repeat: RepeatMode;
  isMiniPlayerVisible: boolean;
  errorMessage: string | null;
  tracksById: Record<string, TrackMeta>;
  playTrack: (trackId: string, queue?: QueueEntry[], index?: number) => void;
  /** Append a track to the queue, or insert it right after the current one. */
  addToQueue: (trackId: string, insertNext?: boolean) => void;
  togglePlay: () => void;
  pause: () => void;
  seekTo: (ms: number) => void;
  next: () => void;
  previous: () => void;
  setShuffle: (mode: ShuffleMode) => void;
  setRepeat: (mode: RepeatMode) => void;
  moveInQueue: (from: number, to: number) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  retry: () => void;
  /** Engine event wiring (called by the audio engine). */
  onEngineLoaded: (durationMs: number) => void;
  onEngineProgress: (positionMs: number, durationMs: number) => void;
  onEngineEnded: () => void;
  onEngineError: (code: string, message: string) => void;
  onEngineNoisy: () => void;
}

const machine = new PlaybackStateMachine();
const engine = createAudioEngine();

function hydrate(): PersistedPlayerState {
  try {
    const raw = storage.getString(PLAYER_STORAGE_KEY);
    if (!raw) return { queue: [], queueIndex: -1, currentTrackId: null };
    const parsed = JSON.parse(raw) as PersistedPlayerState;
    if (!Array.isArray(parsed.queue) || parsed.queue.length === 0) {
      return { queue: [], queueIndex: -1, currentTrackId: null };
    }
    return {
      queue: parsed.queue,
      queueIndex: Math.min(parsed.queueIndex, parsed.queue.length - 1),
      currentTrackId:
        parsed.queue[Math.min(parsed.queueIndex, parsed.queue.length - 1)]?.trackId ?? null,
    };
  } catch {
    return { queue: [], queueIndex: -1, currentTrackId: null };
  }
}

function queueMeta(entry: QueueEntry): { title?: string; artist?: string } {
  return { title: entry.title, artist: entry.artist };
}

export const usePlaybackStore = create<PlaybackStateValue>((set, get) => {
  const hydrated = hydrate();

  const commit = (partial: Partial<PlaybackStateValue>) => {
    set(partial);
    const { queue, queueIndex, currentTrackId } = get();
    const persisted: PersistedPlayerState = { queue, queueIndex, currentTrackId };
    storage.setString(PLAYER_STORAGE_KEY, JSON.stringify(persisted));
  };

  const playFromQueue = (index: number) => {
    const { queue, tracksById } = get();
    const entry = queue[index];
    if (!entry) return;
    machine.reset();
    machine.transition(PlaybackState.LOADING);
    commit({
      status: machine.current(),
      currentTrackId: entry.trackId,
      queueIndex: index,
      positionMs: 0,
      isMiniPlayerVisible: true,
      errorMessage: null,
    });
    void (async () => {
      try {
        const meta = tracksById[entry.trackId];
        const localUri = await completedLocalUri(entry.trackId);
        let uri = localUri;
        let headers: Record<string, string> | undefined;
        if (!uri) {
          const resolved = await musicApi.resolvePlayback(entry.trackId);
          uri = resolved.source.uri;
          headers = resolved.source.headers;
          const track = resolved.track;
          if (!meta) {
            set({
              tracksById: {
                ...get().tracksById,
                [entry.trackId]: {
                  title: track.title,
                  artist: track.artists.map((a) => a.name).join(', '),
                  albumTitle: track.album?.title,
                  artworkUrl: track.artworkUrl,
                },
              },
            });
          }
        }
        await engine.load(uri, headers, get().tracksById[entry.trackId]);
        engine.play();
      } catch (error) {
        get().onEngineError('RESOLVE_FAILED', String(error));
      }
    })();
  };

  const advance = (direction: 1 | -1, wrap: boolean) => {
    const { queue, queueIndex, shuffle } = get();
    if (queue.length === 0) return;

    let nextIndex: number;
    if (direction === 1 && shuffle === 'ON' && queue.length > 1) {
      let candidate = Math.floor(Math.random() * queue.length);
      if (candidate === queueIndex) candidate = (candidate + 1) % queue.length;
      nextIndex = candidate;
    } else {
      nextIndex = queueIndex + direction;
      if (nextIndex < 0 || nextIndex >= queue.length) {
        if (wrap) nextIndex = direction === 1 ? 0 : queue.length - 1;
        else {
          machine.reset();
          commit({ status: machine.current() });
          return;
        }
      }
    }
    playFromQueue(nextIndex);
  };

  return {
    status: PlaybackState.IDLE,
    currentTrackId: hydrated.currentTrackId,
    queue: hydrated.queue,
    queueIndex: hydrated.queueIndex,
    positionMs: 0,
    durationMs: 0,
    shuffle: 'OFF',
    repeat: 'OFF',
    isMiniPlayerVisible: hydrated.queue.length > 0,
    errorMessage: null,
    tracksById: {},

    playTrack: (trackId, queue = [], index = 0) => {
      const fallbackQueue: QueueEntry[] =
        queue.length > 0 ? queue : [{ trackId, source: 'REMOTE' }];
      const queueWithMeta = fallbackQueue.map((entry) => ({
        ...entry,
        ...queueMeta(entry),
      }));
      commit({
        queue: queueWithMeta,
        queueIndex: index,
        currentTrackId: trackId,
      });
      playFromQueue(index);
    },

    addToQueue: (trackId, insertNext = false) => {
      const { queue, queueIndex, currentTrackId } = get();
      const entry: QueueEntry = { trackId, source: 'REMOTE' };
      const hasCurrent = queueIndex >= 0 && queue.length > 0;

      if (!hasCurrent) {
        commit({
          queue: [entry],
          queueIndex: 0,
          currentTrackId: trackId,
          isMiniPlayerVisible: true,
        });
        return;
      }

      const insertAt = insertNext ? queueIndex + 1 : queue.length;
      const nextQueue = [...queue];
      nextQueue.splice(insertAt, 0, entry);
      const nextIndex = insertNext && queueIndex >= insertAt ? queueIndex + 1 : queueIndex;
      commit({
        queue: nextQueue,
        queueIndex: nextIndex,
        currentTrackId: currentTrackId ?? nextQueue[nextIndex]?.trackId ?? null,
      });
    },

    togglePlay: () => {
      const { status } = get();
      if (status === PlaybackState.PLAYING) {
        engine.pause();
        machine.transition(PlaybackState.PAUSED);
        set({ status: machine.current() });
      } else if (status === PlaybackState.PAUSED) {
        engine.play();
        machine.transition(PlaybackState.PLAYING);
        set({ status: machine.current() });
      }
    },

    pause: () => {
      if (machine.canTransition(PlaybackState.PAUSED)) {
        engine.pause();
        machine.transition(PlaybackState.PAUSED);
        set({ status: machine.current() });
      }
    },

    seekTo: (ms) => {
      if (!get().currentTrackId) return;
      const clamped = Math.max(0, Math.min(ms, get().durationMs || ms));
      set({ positionMs: clamped });
      engine.seek(clamped);
    },

    next: () => {
      const { queue, queueIndex, repeat } = get();
      if (queue.length === 0) return;
      if (queueIndex >= queue.length - 1 && repeat === 'OFF') {
        if (machine.canTransition(PlaybackState.ENDED)) {
          machine.transition(PlaybackState.ENDED);
        } else {
          machine.reset();
        }
        set({ status: machine.current() });
        return;
      }
      advance(1, repeat === 'ALL');
    },

    previous: () => {
      const { positionMs, queueIndex } = get();
      if (positionMs > 3000 || queueIndex <= 0) {
        set({ positionMs: 0 });
        engine.seek(0);
        return;
      }
      advance(-1, get().repeat === 'ALL');
    },

    setShuffle: (shuffle) => set({ shuffle }),
    setRepeat: (repeat) => set({ repeat }),

    moveInQueue: (from, to) => {
      const { queue, queueIndex } = get();
      if (from < 0 || from >= queue.length || to < 0 || to >= queue.length || from === to) return;
      const nextQueue = [...queue];
      const [moved] = nextQueue.splice(from, 1);
      nextQueue.splice(to, 0, moved!);
      let nextIndex = queueIndex;
      if (queueIndex === from) nextIndex = to;
      else if (from < queueIndex && to >= queueIndex) nextIndex = queueIndex - 1;
      else if (from > queueIndex && to <= queueIndex) nextIndex = queueIndex + 1;
      commit({
        queue: nextQueue,
        queueIndex: nextIndex,
        currentTrackId: nextQueue[nextIndex]?.trackId ?? get().currentTrackId,
      });
    },

    removeFromQueue: (index) => {
      const { queue, queueIndex, currentTrackId } = get();
      if (index < 0 || index >= queue.length) return;
      const nextQueue = queue.filter((_, i) => i !== index);
      let nextIndex = queueIndex;
      if (index < queueIndex) nextIndex = queueIndex - 1;
      else if (index === queueIndex) nextIndex = Math.min(queueIndex, nextQueue.length - 1);
      if (nextQueue.length === 0) {
        engine.release();
        machine.reset();
        set({
          status: machine.current(),
          queue: [],
          queueIndex: -1,
          currentTrackId: null,
          positionMs: 0,
          durationMs: 0,
          isMiniPlayerVisible: false,
        });
        storage.remove(PLAYER_STORAGE_KEY);
        return;
      }
      const nextTrack = nextQueue[nextIndex]?.trackId ?? null;
      if (currentTrackId && index === queueIndex && nextTrack !== currentTrackId) {
        engine.release();
        commit({ queue: nextQueue, queueIndex: nextIndex, currentTrackId: nextTrack });
        playFromQueue(nextIndex);
        return;
      }
      commit({
        queue: nextQueue,
        queueIndex: nextIndex,
        currentTrackId: currentTrackId ?? nextTrack,
      });
    },

    clearQueue: () => {
      engine.release();
      machine.reset();
      set({
        status: machine.current(),
        queue: [],
        queueIndex: -1,
        currentTrackId: null,
        positionMs: 0,
        durationMs: 0,
        isMiniPlayerVisible: false,
        errorMessage: null,
      });
      storage.remove(PLAYER_STORAGE_KEY);
    },

    retry: () => {
      const { currentTrackId, queueIndex } = get();
      if (!currentTrackId) return;
      playFromQueue(Math.max(0, queueIndex));
    },

    onEngineLoaded: (durationMs) => {
      if (machine.canTransition(PlaybackState.PLAYING)) {
        machine.transition(PlaybackState.PLAYING);
      }
      set({ status: machine.current(), durationMs });
    },

    onEngineProgress: (positionMs, durationMs) => {
      set({ positionMs, durationMs: durationMs > 0 ? durationMs : get().durationMs });
    },

    onEngineEnded: () => {
      const { repeat, queueIndex, queue } = get();
      if (repeat === 'ONE') {
        const entry = queue[queueIndex];
        if (entry) {
          void (async () => {
            const localUri = await completedLocalUri(entry.trackId);
            let uri = localUri;
            let headers: Record<string, string> | undefined;
            if (!uri) {
              const resolved = await musicApi.resolvePlayback(entry.trackId);
              uri = resolved.source.uri;
              headers = resolved.source.headers;
            }
            await engine.load(uri, headers, get().tracksById[entry.trackId]);
            engine.play();
          })().catch((error) => get().onEngineError('RESOLVE_FAILED', String(error)));
          return;
        }
      }
      if (repeat === 'ALL' || queueIndex < queue.length - 1) {
        advance(1, repeat === 'ALL');
        return;
      }
      if (machine.canTransition(PlaybackState.ENDED)) {
        machine.transition(PlaybackState.ENDED);
      } else {
        machine.reset();
      }
      set({ status: machine.current() });
    },

    onEngineError: (code, message) => {
      machine.transition(PlaybackState.ERROR);
      set({ status: machine.current(), errorMessage: message, isMiniPlayerVisible: true });
    },

    onEngineNoisy: () => {
      get().pause();
    },
  };
});

/** Wire the engine's events to the store (once, at module load). */
engine.setHandler({
  onLoaded: (durationMs) => usePlaybackStore.getState().onEngineLoaded(durationMs),
  onProgress: (positionMs, durationMs) =>
    usePlaybackStore.getState().onEngineProgress(positionMs, durationMs),
  onEnded: () => usePlaybackStore.getState().onEngineEnded(),
  onError: (code, message) => usePlaybackStore.getState().onEngineError(code, message),
  onAudioBecomingNoisy: () => usePlaybackStore.getState().onEngineNoisy(),
});
