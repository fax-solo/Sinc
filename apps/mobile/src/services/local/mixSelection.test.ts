import { describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { mulberry32, shuffled } from './affinity';
import { MAX_PER_ARTIST, pickMoodsForDay, selectMixTracks } from './mixSelection';

function track(id: string, artist: string, title: string): CanonicalTrack {
  return {
    id,
    title,
    artists: [{ id: `a:${artist}`, name: artist, providerIds: {}, genres: [] }],
    album: {
      id: `al:${title}`,
      title,
      artist: { id: `a:${artist}`, name: artist, providerIds: {}, genres: [] },
      trackCount: 1,
      providerIds: {},
      type: 'album',
    },
    durationMs: 200_000,
    providerIds: {},
    explicit: false,
  };
}

const POOL = [
  track('t1', 'Janet', 'Song One'),
  track('t2', 'Janet', 'Song Two'),
  track('t3', 'Janet', 'Song Three'),
  track('t4', 'Janet', 'Song Four'),
  track('t5', 'Omar', 'Desert Rose'),
  track('t6', 'Omar', 'Desert Rain'),
  track('t7', 'Layla', 'Night Drive'),
  track('t8', 'Layla', 'Day Drive'),
];

describe('selectMixTracks', () => {
  it('caps the number of tracks per lead artist (mix diversity)', () => {
    const result = selectMixTracks(POOL, 8, () => 1);
    const countFor = (artist: string) => result.filter((t) => t.artists[0]?.name === artist).length;
    expect(countFor('Janet')).toBeLessThanOrEqual(MAX_PER_ARTIST);
    expect(countFor('Omar')).toBeLessThanOrEqual(MAX_PER_ARTIST);
    expect(countFor('Layla')).toBeLessThanOrEqual(MAX_PER_ARTIST);
  });

  it('prefers higher-scored candidates', () => {
    const scores: Record<string, number> = {
      t1: 0,
      t2: 0,
      t3: 0,
      t4: 0,
      t5: 5,
      t6: 5,
      t7: 5,
      t8: 5,
    };
    const result = selectMixTracks(POOL, 4, (t) => scores[t.id]);
    const picked = result.map((t) => t.id);
    // Omar + Layla all score 5 — Janet's 4 slots only partially fit the cap,
    // but scored artists should dominate the first picks.
    expect(picked.filter((id) => ['t1', 't2', 't3', 't4'].includes(id)).length).toBeLessThanOrEqual(
      1
    );
  });

  it('is deterministic given a seeded shuffle', () => {
    const a = shuffled(POOL, mulberry32(7));
    const b = shuffled(POOL, mulberry32(7));
    const resultA = selectMixTracks(a, 5, (t) => (t.id === 't5' ? 10 : 1));
    const resultB = selectMixTracks(b, 5, (t) => (t.id === 't5' ? 10 : 1));
    expect(resultA.map((t) => t.id)).toEqual(resultB.map((t) => t.id));
  });

  it('handles empty pools and oversized requests gracefully', () => {
    expect(selectMixTracks([], 10, () => 1)).toEqual([]);
    // Pool: Janet×4, Omar×2, Layla×2 — the artist cap floors Janet at 3.
    const result = selectMixTracks(POOL, 50, () => 1);
    expect(result.length).toBe(7); // 3 + 2 + 2
    const janet = result.filter((t) => t.artists[0]?.name === 'Janet').length;
    expect(janet).toBe(MAX_PER_ARTIST);
  });
});

describe('pickMoodsForDay', () => {
  const moods = Array.from({ length: 10 }, (_, i) => ({
    genreId: i,
    name: `Mood ${i}`,
    search: `mood ${i}`,
  }));

  it('is stable for the same seed and changes across seeds (days)', () => {
    const day1 = pickMoodsForDay(moods, 1234, 4);
    const day1Again = pickMoodsForDay(moods, 1234, 4);
    expect(day1.map((m) => m.genreId)).toEqual(day1Again.map((m) => m.genreId));
    const day2 = pickMoodsForDay(moods, 1235, 4);
    expect(day2.map((m) => m.genreId)).not.toEqual(day1.map((m) => m.genreId));
  });

  it('returns distinct moods (no repeats in one rotation)', () => {
    const picked = pickMoodsForDay(moods, 555, 4);
    const ids = picked.map((m) => m.genreId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(4);
  });
});
