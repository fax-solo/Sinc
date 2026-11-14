/**
 * Pure seek-bar geometry. Kept outside the component so the tap/drag math can
 * be unit-tested without a React Native renderer.
 */

export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Touch x position (relative to the full-width bar) -> 0..1. */
export function seekRatioFromTouch(locationX: number, width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return clampRatio(locationX / width);
}

/**
 * Ratio after dragging. `dx` is pixels from the gesture grant, so it must be
 * converted to a ratio and added to the starting ratio — never added to a
 * millisecond position directly.
 */
export function seekRatioFromDrag(startRatio: number, dx: number, width: number): number {
  if (!Number.isFinite(width) || width <= 0) return clampRatio(startRatio);
  return clampRatio(clampRatio(startRatio) + dx / width);
}

/** Convert a 0..1 ratio to a safe, rounded millisecond position. */
export function seekTargetMs(ratio: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.round(clampRatio(ratio) * durationMs);
}
