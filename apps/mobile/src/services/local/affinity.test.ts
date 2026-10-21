import { describe, expect, it } from 'vitest';
import {
  blacklistedTrackIds,
  computeArtistAffinity,
  hashString,
  localDayKey,
  mulberry32,
  shuffled,
  type AffinityEvidence,
} from './affinity';
import type { LibrarySignals } from './musicApi';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function evidence(partial: Partial<AffinityEvidence> = {}): AffinityEvidence {
  return {
    trackArtists: new Map(),
    familiarArtistNames: [],
    knownTracks: new Map(),
    nowMs: NOW,
    ...partial,
  };
}

describe('computeArtistAffinity', () => {
  it('ranks artists by aggregate track + artist evidence', () => {
    const trackArtists = new Map([
      ['t1', 'A'],
      ['t2', 'A'],
      ['t3', 'B'],
    ]);
    const signals: LibrarySignals = {
      playCounts: [
        { trackId: 't1', count: 10, lastPlayedAt: NOW },
        { trackId: 't2', count: 10, lastPlayedAt: NOW },
        { trackId: 't3', count: 2, lastPlayedAt: NOW },
      ],
      artistPlayCounts: [
        { name: 'A', count: 5 },
        { name: 'B', count: 5 },
      ],
      skipCounts: [],
      completedCounts: [],
      thumbs: [],
      hiddenTrackIds: [],
      hiddenArtistNames: [],
      discoveryPreference: 0.5,
    };
    const affinity = computeArtistAffinity(signals, evidence({ trackArtists }));
    // A: 5 + 20*0.7 = 19 ; B: 5 + 1.4 = 6.4 → A ranks first, both present
    expect(affinity[0].name).toBe('A');
    expect(affinity.map((a) => a.name)).toContain('B');
  });

  it('decays stale evidence (recency half-life)', () => {
    const trackArtists = new Map([
      ['fresh', 'Fresh'],
      ['stale', 'Stale'],
    ]);
    const signals: LibrarySignals = {
      playCounts: [
        { trackId: 'fresh', count: 6, lastPlayedAt: NOW },
        { trackId: 'stale', count: 6, lastPlayedAt: NOW - 98 * DAY },
      ],
      artistPlayCounts: [],
      skipCounts: [],
      completedCounts: [],
      thumbs: [],
      hiddenTrackIds: [],
      hiddenArtistNames: [],
      discoveryPreference: 0.5,
    };
    const affinity = computeArtistAffinity(signals, evidence({ trackArtists }));
    const byName = new Map(affinity.map((a) => [a.name, a]));
    expect(byName.get('Fresh')!.score).toBeGreaterThan(byName.get('Stale')!.score);
    expect(byName.get('Stale')!.recency).toBeLessThan(byName.get('Fresh')!.recency);
  });

  it('weights completions above plain starts', () => {
    const trackArtists = new Map([
      ['full', 'FullListen'],
      ['partial', 'PartialListen'],
    ]);
    const signals: LibrarySignals = {
      playCounts: [
        { trackId: 'full', count: 10, lastPlayedAt: NOW },
        { trackId: 'partial', count: 10, lastPlayedAt: NOW },
      ],
      artistPlayCounts: [],
      skipCounts: [],
      completedCounts: [{ trackId: 'full', count: 10 }],
      thumbs: [],
      hiddenTrackIds: [],
      hiddenArtistNames: [],
      discoveryPreference: 0.5,
    };
    const affinity = computeArtistAffinity(signals, evidence({ trackArtists }));
    const byName = new Map(affinity.map((a) => [a.name, a]));
    const full = byName.get('FullListen')!.evidence;
    const partial = byName.get('PartialListen')!.evidence;
    expect(full).toBeGreaterThan(partial); // starts equal, completions tip it
  });

  it('applies skip penalties and hides artists', () => {
    const trackArtists = new Map([
      ['hated', 'Hated'],
      ['skipped', 'Skipped'],
    ]);
    const signals: LibrarySignals = {
      playCounts: [{ trackId: 'skipped', count: 5, lastPlayedAt: NOW }],
      artistPlayCounts: [{ name: 'Hated', count: 10 }],
      skipCounts: [{ trackId: 'skipped', count: 4 }],
      completedCounts: [],
      thumbs: [],
      hiddenTrackIds: [],
      hiddenArtistNames: ['Hated'],
      discoveryPreference: 0.5,
    };
    const affinity = computeArtistAffinity(signals, evidence({ trackArtists }));
    const names = affinity.map((a) => a.name);
    expect(names).not.toContain('Hated'); // hidden → excluded
    const skipped = affinity.find((a) => a.name === 'Skipped');
    expect(skipped).toBeDefined();
    expect(skipped!.evidence).toBeLessThan(5 * 0.7); // penalties applied
  });

  it('treats followed artists as familiar with an evidence bump', () => {
    const affinity = computeArtistAffinity(
      undefined,
      evidence({ familiarArtistNames: ['Followed Artist'] })
    );
    const followed = affinity.find((a) => a.name === 'Followed Artist');
    expect(followed).toBeDefined();
    expect(followed!.familiar).toBe(true);
    expect(followed!.score).toBeGreaterThan(0);
  });

  it('resolves thumbs through known tracks', () => {
    const knownTracks = new Map<
      string,
      { id: string; artists: Array<{ name: string }> } & Record<string, unknown>
    >([['t1', { id: 't1', artists: [{ name: 'Thumb Artist' }] }]] as never);
    const signals: LibrarySignals = {
      playCounts: [],
      artistPlayCounts: [],
      skipCounts: [],
      completedCounts: [],
      thumbs: [{ targetId: 't1', value: 'up' }],
      hiddenTrackIds: [],
      hiddenArtistNames: [],
      discoveryPreference: 0.5,
    };
    const affinity = computeArtistAffinity(
      signals,
      evidence({ knownTracks: knownTracks as never })
    );
    const thumbArtist = affinity.find((a) => a.name === 'Thumb Artist');
    expect(thumbArtist).toBeDefined();
    expect(thumbArtist!.evidence).toBeCloseTo(2.0);
  });
});

describe('blacklistedTrackIds', () => {
  it('includes hidden tracks and heavily skipped ones', () => {
    const signals: LibrarySignals = {
      playCounts: [],
      artistPlayCounts: [],
      skipCounts: [
        { trackId: 's1', count: 3 },
        { trackId: 's2', count: 2 },
        { trackId: 's3', count: 9 },
      ],
      completedCounts: [],
      thumbs: [],
      hiddenTrackIds: ['h1'],
      hiddenArtistNames: [],
      discoveryPreference: 0.5,
    };
    const blocked = blacklistedTrackIds(signals);
    expect(blocked.has('s1')).toBe(true); // skipCount 3 → excluded
    expect(blocked.has('s2')).toBe(false); // 2 skips is under the threshold
    expect(blocked.has('s3')).toBe(true);
    expect(blocked.has('h1')).toBe(true);
  });
});

describe('deterministic randomness', () => {
  it('hashString is stable and seed-like', () => {
    expect(hashString('sinc-mix:2026-10-17')).toBe(hashString('sinc-mix:2026-10-17'));
    expect(hashString('sinc-mix:2026-10-17')).not.toBe(hashString('sinc-mix:2026-10-18'));
    expect(hashString('')).toBe(0x811c9dc5 >>> 0);
  });

  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('two streams with a different seed diverge', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).not.toEqual(seqB);
  });

  it('localDayKey is YYYY-MM-DD local', () => {
    // 22:30Z is already Oct 17 on a UTC+2 clock — the exact-day assertion is
    // only made when a runtime TZ override actually applies (POSIX runners;
    // Windows ignores runtime TZ changes, so those fall back to the format check).
    const ts = new Date('2026-10-16T22:30:00Z').getTime();
    expect(localDayKey(ts)).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const prevTz = process.env.TZ;
    process.env.TZ = 'Etc/GMT-2'; // POSIX-named UTC+2
    const applied = new Date(ts).getTimezoneOffset() === -120;
    const key = localDayKey(ts);
    process.env.TZ = prevTz;
    if (applied) expect(key).toBe('2026-10-17');
  });

  it('shuffled keeps elements and is deterministic with the same rand', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffledA = shuffled(items, mulberry32(42));
    const shuffledB = shuffled(items, mulberry32(42));
    expect(shuffledA).toEqual(shuffledB);
    expect([...shuffledA].sort((x, y) => x - y)).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // input untouched
  });
});
