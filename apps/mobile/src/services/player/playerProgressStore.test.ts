import { describe, expect, it } from 'vitest';
import { usePlayerProgressStore } from './playerProgressStore';

describe('usePlayerProgressStore', () => {
  it('tracks transient playback position without persisting the queue', () => {
    usePlayerProgressStore.setState({ positionMs: 0, durationMs: 0 });
    usePlayerProgressStore.getState().setProgress(1200, 180000);
    expect(usePlayerProgressStore.getState()).toMatchObject({
      positionMs: 1200,
      durationMs: 180000,
    });
  });

  it('clamps negatives and skips no-op updates', () => {
    usePlayerProgressStore.setState({ positionMs: 100, durationMs: 2000 });
    usePlayerProgressStore.getState().setProgress(-5, 2000);
    expect(usePlayerProgressStore.getState()).toMatchObject({ positionMs: 0, durationMs: 2000 });

    const before = usePlayerProgressStore.getState();
    before.positionMs = 0;
    usePlayerProgressStore.getState().setProgress(-15, -20);
    expect(usePlayerProgressStore.getState()).toMatchObject({ positionMs: 0, durationMs: 0 });
  });

  it('resets to zero', () => {
    usePlayerProgressStore.setState({ positionMs: 5000, durationMs: 300000 });
    usePlayerProgressStore.getState().reset();
    expect(usePlayerProgressStore.getState()).toMatchObject({ positionMs: 0, durationMs: 0 });
  });
});
