import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybackState } from '@sinc/shared';

const storageState = vi.hoisted(() => new Map<string, string>());
const engineMock = vi.hoisted(() => ({
  load: vi.fn(async () => {}),
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
  release: vi.fn(),
  setHandler: vi.fn(),
  snapshot: vi.fn(() => ({ uri: null, headers: undefined, paused: true, rate: 1 })),
  subscribe: vi.fn(() => () => {}),
}));
const musicApiMock = vi.hoisted(() => ({ resolvePlayback: vi.fn() }));

vi.mock('@nozbe/watermelondb/adapters/sqlite', () => ({
  default: class SQLiteAdapterMock {},
}));

vi.mock('../db/database', () => ({ getDatabase: () => null }));
vi.mock('../db/downloads', () => ({
  completedDownloadUri: async () => null,
}));

vi.mock('../storage', () => ({
  STORAGE_KEYS: { PLAYER: 'sinc.player' },
  storage: {
    getString: (key: string) => storageState.get(key) ?? null,
    setString: (key: string, value: string) => storageState.set(key, value),
    remove: (key: string) => storageState.delete(key),
  },
}));

vi.mock('../audio/engine', () => ({
  createAudioEngine: () => engineMock,
}));

vi.mock('../api/music', () => ({
  musicApi: musicApiMock,
}));

function resolvedPayload(trackId: string) {
  return {
    track: {
      id: trackId,
      title: `Track ${trackId}`,
      normalizedTitle: trackId,
      artists: [{ id: 'a1', name: 'Artist One' }],
      durationMs: 200000,
      providerIds: { musicbrainz: trackId },
      providerConfidence: 0.9,
    },
    source: { type: 'remote' as const, uri: `https://cdn.example/${trackId}.mp3`, trackId },
    confidence: 1,
    expiresAt: Date.now() + 3_600_000,
  };
}

describe('playbackStore', () => {
  let store: (typeof import('../state/playbackStore'))['usePlaybackStore'];

  beforeEach(async () => {
    vi.clearAllMocks();
    storageState.clear();
    const mod = await import('../state/playbackStore');
    store = mod.usePlaybackStore;
    engineMock.setHandler.mockClear();
    musicApiMock.resolvePlayback.mockResolvedValue(resolvedPayload('t1'));
    store.setState({
      status: PlaybackState.IDLE,
      currentTrackId: null,
      queue: [],
      queueIndex: -1,
      positionMs: 0,
      durationMs: 0,
      shuffle: 'OFF',
      repeat: 'OFF',
      isMiniPlayerVisible: false,
      errorMessage: null,
      tracksById: {},
    });
  });

  const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

  describe('engine wiring', () => {
    it('playTrack resolves a source URL and loads it in the engine', async () => {
      store.getState().playTrack('t1');
      expect(store.getState().status).toBe(PlaybackState.LOADING);
      await flush();
      expect(musicApiMock.resolvePlayback).toHaveBeenCalledWith('t1');
      expect(engineMock.load).toHaveBeenCalledWith('https://cdn.example/t1.mp3', undefined, {
        title: 'Track t1',
        artist: 'Artist One',
      });
      expect(engineMock.play).toHaveBeenCalled();
      expect(store.getState().tracksById.t1?.title).toBe('Track t1');
    });

    it('onEngineLoaded flips the status to PLAYING and stores the duration', () => {
      store.getState().playTrack('t1');
      store.getState().onEngineLoaded(200_000);
      expect(store.getState().status).toBe(PlaybackState.PLAYING);
      expect(store.getState().durationMs).toBe(200_000);
    });

    it('onEngineProgress updates the position', () => {
      store.getState().playTrack('t1');
      store.getState().onEngineProgress(12_000, 200_000);
      expect(store.getState().positionMs).toBe(12_000);
    });

    it('togglePlay drives the engine and the state machine', () => {
      store.getState().playTrack('t1');
      store.getState().onEngineLoaded(200_000);
      store.getState().togglePlay();
      expect(engineMock.pause).toHaveBeenCalled();
      expect(store.getState().status).toBe(PlaybackState.PAUSED);
      store.getState().togglePlay();
      expect(engineMock.play).toHaveBeenCalled();
      expect(store.getState().status).toBe(PlaybackState.PLAYING);
    });

    it('seekTo clamps and forwards to the engine', () => {
      store.getState().playTrack('t1');
      store.getState().onEngineLoaded(200_000);
      store.getState().seekTo(300_000);
      expect(store.getState().positionMs).toBe(200_000);
      expect(engineMock.seek).toHaveBeenCalledWith(200_000);
    });

    it('onEngineError surfaces an error state that retry recovers from', async () => {
      store.getState().playTrack('t1');
      store.getState().onEngineError('E1001', 'boom');
      expect(store.getState().status).toBe(PlaybackState.ERROR);
      store.getState().retry();
      await flush();
      expect(musicApiMock.resolvePlayback).toHaveBeenCalledTimes(2);
      await flush();
      expect(engineMock.load).toHaveBeenCalledTimes(2);
    });

    it('engine load failure also lands in the error state', async () => {
      musicApiMock.resolvePlayback.mockRejectedValue(new Error('offline'));
      store.getState().playTrack('t1');
      await flush();
      expect(store.getState().status).toBe(PlaybackState.ERROR);
      expect(store.getState().errorMessage).toBeTruthy();
    });

    it('onEngineNoisy pauses playback (interruptions)', () => {
      store.getState().playTrack('t1');
      store.getState().onEngineLoaded(200_000);
      store.getState().onEngineNoisy();
      expect(engineMock.pause).toHaveBeenCalled();
      expect(store.getState().status).toBe(PlaybackState.PAUSED);
    });
  });

  describe('auto-advance and repeat', () => {
    it('onEngineEnded advances to the next track', async () => {
      store.getState().playTrack('t1', [
        { trackId: 't1', source: 'REMOTE' },
        { trackId: 't2', source: 'REMOTE' },
      ]);
      musicApiMock.resolvePlayback.mockResolvedValue(resolvedPayload('t2'));
      store.getState().onEngineEnded();
      expect(store.getState().queueIndex).toBe(1);
      expect(store.getState().status).toBe(PlaybackState.LOADING);
      await flush();
      expect(engineMock.load).toHaveBeenCalledWith('https://cdn.example/t2.mp3', undefined, {
        title: 'Track t2',
        artist: 'Artist One',
      });
    });

    it('repeat ONE reloads the same track on end', async () => {
      store.getState().playTrack('t1', [{ trackId: 't1', source: 'REMOTE' }]);
      store.getState().setRepeat('ONE');
      store.getState().onEngineEnded();
      expect(store.getState().queueIndex).toBe(0);
      await flush();
      expect(musicApiMock.resolvePlayback).toHaveBeenCalledTimes(2);
    });

    it('repeat OFF at the end of the queue marks ENDED', () => {
      store.getState().playTrack('t1', [{ trackId: 't1', source: 'REMOTE' }]);
      store.getState().onEngineLoaded(200_000);
      store.getState().onEngineEnded();
      expect(store.getState().status).toBe(PlaybackState.ENDED);
    });

    it('repeat ALL wraps around at the end of the queue', () => {
      store.getState().playTrack('t1', [
        { trackId: 't1', source: 'REMOTE' },
        { trackId: 't2', source: 'REMOTE' },
      ]);
      store.getState().setRepeat('ALL');
      store.getState().next();
      store.getState().next();
      expect(store.getState().queueIndex).toBe(0);
    });

    it('shuffle ON picks a different track when advancing', () => {
      store.getState().playTrack('t1', [
        { trackId: 't1', source: 'REMOTE' },
        { trackId: 't2', source: 'REMOTE' },
        { trackId: 't3', source: 'REMOTE' },
      ]);
      store.getState().setShuffle('ON');
      store.getState().next();
      expect(store.getState().queueIndex).not.toBe(0);
    });
  });

  describe('queue management', () => {
    it('addToQueue appends after the current track', () => {
      store.getState().playTrack('t1', [{ trackId: 't1', source: 'REMOTE' }]);
      store.getState().addToQueue('t2');
      store.getState().addToQueue('t3');
      expect(store.getState().queue.map((e) => e.trackId)).toEqual(['t1', 't2', 't3']);
      expect(store.getState().queueIndex).toBe(0);
    });

    it('addToQueue with insertNext puts the track right after the current one', () => {
      store.getState().playTrack('t1', [{ trackId: 't1', source: 'REMOTE' }]);
      store.getState().addToQueue('t2');
      store.getState().addToQueue('t3');
      store.getState().next();
      store.getState().addToQueue('t9', true);
      expect(store.getState().queue.map((e) => e.trackId)).toEqual(['t1', 't2', 't9', 't3']);
      expect(store.getState().queueIndex).toBe(1);
    });

    it('addToQueue with no active playback starts a queue with that track', () => {
      store.getState().addToQueue('solo');
      expect(store.getState().queue.map((e) => e.trackId)).toEqual(['solo']);
      expect(store.getState().currentTrackId).toBe('solo');
      expect(store.getState().queueIndex).toBe(0);
      expect(store.getState().isMiniPlayerVisible).toBe(true);
    });

    it('moveInQueue reorders and keeps the current index consistent', () => {
      store.getState().playTrack('t1', [
        { trackId: 't1', source: 'REMOTE' },
        { trackId: 't2', source: 'REMOTE' },
        { trackId: 't3', source: 'REMOTE' },
      ]);
      store.getState().moveInQueue(0, 2);
      expect(store.getState().queue.map((e) => e.trackId)).toEqual(['t2', 't3', 't1']);
      expect(store.getState().queueIndex).toBe(2);
      expect(store.getState().currentTrackId).toBe('t1');
    });

    it('removeFromQueue drops a non-current track', () => {
      store.getState().playTrack('t1', [
        { trackId: 't1', source: 'REMOTE' },
        { trackId: 't2', source: 'REMOTE' },
        { trackId: 't3', source: 'REMOTE' },
      ]);
      store.getState().removeFromQueue(2);
      expect(store.getState().queue.map((e) => e.trackId)).toEqual(['t1', 't2']);
      expect(store.getState().currentTrackId).toBe('t1');
    });

    it('removing the current track plays the next one', async () => {
      store.getState().playTrack('t1', [
        { trackId: 't1', source: 'REMOTE' },
        { trackId: 't2', source: 'REMOTE' },
      ]);
      musicApiMock.resolvePlayback.mockResolvedValue(resolvedPayload('t2'));
      store.getState().removeFromQueue(0);
      expect(store.getState().currentTrackId).toBe('t2');
      await flush();
      expect(engineMock.load).toHaveBeenCalledWith('https://cdn.example/t2.mp3', undefined, {
        title: 'Track t2',
        artist: 'Artist One',
      });
    });

    it('clearQueue releases the engine and resets everything', () => {
      store.getState().playTrack('t1', [{ trackId: 't1', source: 'REMOTE' }]);
      store.getState().clearQueue();
      expect(engineMock.release).toHaveBeenCalled();
      expect(store.getState().queue).toEqual([]);
      expect(store.getState().currentTrackId).toBeNull();
      expect(store.getState().isMiniPlayerVisible).toBe(false);
      expect(storageState.has('sinc.player')).toBe(false);
    });
  });

  describe('persistence', () => {
    it('persists queue state on changes', () => {
      store.getState().playTrack('t1', [{ trackId: 't1', source: 'REMOTE' }]);
      const raw = storageState.get('sinc.player');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!) as { queue: Array<{ trackId: string }> };
      expect(parsed.queue.map((e) => e.trackId)).toEqual(['t1']);
    });

    it('hydrates the queue from storage on load', async () => {
      storageState.set(
        'sinc.player',
        JSON.stringify({
          queue: [{ trackId: 'hydrated', source: 'REMOTE', title: 'Hydrated Track' }],
          queueIndex: 0,
          currentTrackId: 'hydrated',
        }),
      );
      vi.resetModules();
      const mod = await import('../state/playbackStore');
      const fresh = mod.usePlaybackStore.getState();
      expect(fresh.queue.map((e) => e.trackId)).toEqual(['hydrated']);
      expect(fresh.currentTrackId).toBe('hydrated');
      expect(fresh.isMiniPlayerVisible).toBe(true);
      expect(fresh.queue[0]?.title).toBe('Hydrated Track');
    });

    it('ignores corrupted persisted state', async () => {
      storageState.set('sinc.player', 'not-json{{{');
      vi.resetModules();
      const mod = await import('../state/playbackStore');
      expect(mod.usePlaybackStore.getState().queue).toEqual([]);
      expect(mod.usePlaybackStore.getState().currentTrackId).toBeNull();
    });
  });

  describe('next/previous', () => {
    it('next advances through the queue and ends at the last track', () => {
      store.getState().playTrack('t1', [
        { trackId: 't1', source: 'REMOTE' },
        { trackId: 't2', source: 'REMOTE' },
      ]);
      store.getState().onEngineLoaded(200_000);
      store.getState().next();
      expect(store.getState().currentTrackId).toBe('t2');
      expect(store.getState().queueIndex).toBe(1);
      store.getState().onEngineLoaded(200_000);
      store.getState().next();
      expect(store.getState().status).toBe(PlaybackState.ENDED);
    });

    it('next at the queue end while still loading resets to idle instead of crashing', () => {
      store.getState().playTrack('t1', [{ trackId: 't1', source: 'REMOTE' }]);
      expect(() => store.getState().next()).not.toThrow();
      expect(store.getState().status).toBe(PlaybackState.IDLE);
    });

    it('previous rewinds when the position is past the restart window', () => {
      store.getState().playTrack('t1', [{ trackId: 't1', source: 'REMOTE' }]);
      store.getState().onEngineLoaded(200_000);
      store.getState().onEngineProgress(10_000, 200_000);
      store.getState().previous();
      expect(store.getState().positionMs).toBe(0);
      expect(store.getState().currentTrackId).toBe('t1');
    });
  });
});
