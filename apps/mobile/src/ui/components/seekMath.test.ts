import { describe, expect, it } from 'vitest';
import {
  clampRatio,
  seekRatioFromDrag,
  seekRatioFromTouch,
  seekTargetMs,
} from './seekMath';

describe('seekMath', () => {
  it('maps a tap to a ratio inside the bar', () => {
    expect(seekRatioFromTouch(150, 300)).toBe(0.5);
    expect(seekRatioFromTouch(-20, 300)).toBe(0);
    expect(seekRatioFromTouch(420, 300)).toBe(1);
  });

  it('converts drag pixels into a ratio (not milliseconds)', () => {
    // Regression: a 2 px drag from the middle used to become
    // (90_000 ms + 2) / 300 px -> clamped to the end of the song.
    expect(seekRatioFromDrag(0.5, 2, 300)).toBeCloseTo(0.5067, 3);
    expect(seekRatioFromDrag(0.5, -30, 300)).toBe(0.4);
  });

  it('clamps out-of-range drags and guards zero widths', () => {
    expect(seekRatioFromDrag(0.95, 100, 300)).toBe(1);
    expect(seekRatioFromDrag(0.1, -100, 300)).toBe(0);
    expect(seekRatioFromDrag(0.1, 10, 0)).toBe(0.1);
    expect(seekRatioFromTouch(10, 0)).toBe(0);
    expect(clampRatio(Number.NaN)).toBe(0);
  });

  it('converts a ratio to a clamped, rounded millisecond target', () => {
    expect(seekTargetMs(0.5, 180_000)).toBe(90_000);
    expect(seekTargetMs(1.2, 180_000)).toBe(180_000);
    expect(seekTargetMs(-0.2, 180_000)).toBe(0);
    expect(seekTargetMs(0.5, 0)).toBe(0);
  });
});
