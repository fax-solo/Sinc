import { describe, expect, it } from 'vitest';
import { selectedIdsFromList, toggleSelectedId } from './selectionMath';

describe('selection helpers', () => {
  it('toggles ids without mutating the previous set', () => {
    const first = new Set<string>();
    const second = toggleSelectedId(first, 'a');
    const third = toggleSelectedId(second, 'b');
    const fourth = toggleSelectedId(third, 'a');

    expect(first.size).toBe(0);
    expect([...second]).toEqual(['a']);
    expect([...third]).toEqual(['a', 'b']);
    expect([...fourth]).toEqual(['b']);
  });

  it('selects all unique ids', () => {
    expect([...selectedIdsFromList(['a', 'b', 'a'])]).toEqual(['a', 'b']);
  });
});
