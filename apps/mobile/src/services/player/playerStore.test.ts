import { beforeEach, describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { selectCurrentTrack, usePlayerStore } from './playerStore';
import { usePlayerProgressStore } from './playerProgressStore';

function track(id: string, title = `Track ${id}`): CanonicalTrack {
  return {
    id,
    title,
    artists: [{ id: `a-${id}`, name: 'Artist', providerIds: {}, genres: [] }],
    durationMs: 1000,
    artworkUrl: undefined,
    providerIds: { itunes: id },
    explicit: false,
  };
}

const t1 = track('itunes:1');
const t2 = track('itunes:2');
const t3 = track('itunes:3');
const t4 = track('itunes:4');

function resetStore() {
  void usePlayerStore.persist.clearStorage();
  usePlayerStore.setState({
    status: 'idle',
    queue: [],
    currentIndex: -1,
    shuffle: 'off',
    repeat: 'off',
    errorMessage: null,
  });
  usePlayerProgressStore.setState({ positionMs: 0, durationMs: 0 });
}

beforeEach(() => {
  storage.remove(STORAGE_KEYS.PLAYER);
  resetStore();
});

describe('playerStore', () => {
  it('playQueue sets queue, index and loading status', () => {
    usePlayerStore.getState().playQueue([t1, t2, t3], 1);

    const state = usePlayerStore.getState();
    expect(state.queue).toEqual([t1, t2, t3]);
    expect(state.currentIndex).toBe(1);
    expect(state.status).toBe('loading');
    expect(selectCurrentTrack(state)?.id).toBe('itunes:2');
  });

  it('playQueue clamps an out-of-range start index', () => {
    usePlayerStore.getState().playQueue([t1, t2], 10);
    expect(usePlayerStore.getState().currentIndex).toBe(1);
  });

  it('playQueue with empty tracks keeps idle', () => {
    usePlayerStore.getState().playQueue([]);
    expect(usePlayerStore.getState().status).toBe('idle');
    expect(usePlayerStore.getState().currentIndex).toBe(-1);
  });

  it('playTrack queues a single track', () => {
    usePlayerStore.getState().playTrack(t1);
    const state = usePlayerStore.getState();
    expect(state.queue).toEqual([t1]);
    expect(state.currentIndex).toBe(0);
    expect(state.status).toBe('loading');
  });

  it('next advances to the following track', () => {
    usePlayerStore.getState().playQueue([t1, t2, t3], 0);
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(usePlayerStore.getState().status).toBe('loading');
  });

  it('next at the end ends playback without repeat', () => {
    usePlayerStore.getState().playQueue([t1, t2], 1);
    usePlayerStore.getState().next();
    const state = usePlayerStore.getState();
    expect(state.status).toBe('ended');
    expect(state.currentIndex).toBe(1);
  });

  it('next wraps to the start with repeat all', () => {
    usePlayerStore.getState().playQueue([t1, t2], 1);
    usePlayerStore.getState().setRepeat('all');
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });

  it('next with shuffle on never stays on the same track', () => {
    usePlayerStore.getState().playQueue([t1, t2, t3, t4], 0);
    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().next();
    const first = usePlayerStore.getState().currentIndex;
    expect(first).not.toBe(0);
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().currentIndex).not.toBe(first);
  });

  it('previous clamps at the first track', () => {
    usePlayerStore.getState().playQueue([t1, t2, t3], 2);
    usePlayerStore.getState().previous();
    expect(usePlayerStore.getState().currentIndex).toBe(1);
    usePlayerStore.getState().previous();
    usePlayerStore.getState().previous();
    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });

  it('seekTo clamps negative positions', () => {
    usePlayerProgressStore.getState().setProgress(-5, 0);
    expect(usePlayerProgressStore.getState().positionMs).toBe(0);
  });

  it('setProgress updates position and duration', () => {
    usePlayerProgressStore.getState().setProgress(500, 1000);
    expect(usePlayerProgressStore.getState().positionMs).toBe(500);
    expect(usePlayerProgressStore.getState().durationMs).toBe(1000);
  });

  it('toggleShuffle and setRepeat persist their mode', () => {
    usePlayerStore.getState().toggleShuffle();
    expect(usePlayerStore.getState().shuffle).toBe('on');
    usePlayerStore.getState().setRepeat('one');
    expect(usePlayerStore.getState().repeat).toBe('one');
  });

  it('clearQueue resets playback', () => {
    usePlayerStore.getState().playQueue([t1, t2], 0);
    usePlayerStore.getState().clearQueue();
    const state = usePlayerStore.getState();
    expect(state.queue).toEqual([]);
    expect(state.currentIndex).toBe(-1);
    expect(state.status).toBe('idle');
  });
});
