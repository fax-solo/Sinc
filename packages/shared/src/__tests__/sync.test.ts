import { describe, expect, it } from 'vitest';
import { favoriteUnion, type SyncFavorite } from '../sync/sync.js';

function fav(overrides: Partial<SyncFavorite> = {}): SyncFavorite {
  return {
    id: `f-${Math.random().toString(36).slice(2)}`,
    targetType: 'track',
    targetId: 't1',
    addedAt: 1000,
    ...overrides,
  };
}

describe('favoriteUnion', () => {
  it('adds new favorites and removes existing ones (toggle semantics)', () => {
    const a = fav({ id: 'a', targetId: 't1', addedAt: 1000 });
    const b = fav({ id: 'b', targetType: 'artist', targetId: 'a1', addedAt: 2000 });
    const toggled = favoriteUnion(
      [a, b],
      [
        fav({ id: 'c', targetType: 'album', targetId: 'al1', addedAt: 3000 }),
        fav({ id: 'd', targetId: 't1', addedAt: 4000 }),
      ],
    );
    expect(toggled).toHaveLength(2);
    expect(toggled.map((f) => `${f.targetType}:${f.targetId}`)).toEqual(['artist:a1', 'album:al1']);
  });

  it('toggling twice returns to the original set', () => {
    const a = fav({ id: 'a', targetId: 't1' });
    const once = favoriteUnion([a], [fav({ id: 'b', targetId: 't1' })]);
    expect(once).toHaveLength(0);
    const twice = favoriteUnion([], [fav({ id: 'b', targetId: 't1' })]);
    expect(twice).toHaveLength(1);
  });

  it('orders the result by addedAt (stable union order)', () => {
    const late = fav({ id: 'x', targetId: 't9', addedAt: 9000 });
    const early = fav({ id: 'y', targetId: 't0', addedAt: 10 });
    const result = favoriteUnion([late, early], []);
    expect(result.map((f) => f.targetId)).toEqual(['t0', 't9']);
  });
});
