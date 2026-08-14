import { describe, it, expect } from 'vitest';
import {
  ulid,
  ulidTime,
  isUlid,
  normalizeTitle,
  normalizeArtist,
  stripVersion,
  levenshteinSimilarity,
  durationsCompatible,
  trackFingerprint,
} from '../index.js';

describe('ulid', () => {
  it('produces 26-char valid ULIDs', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
  });

  it('is time-sortable', () => {
    const a = ulid(1000);
    const b = ulid(2000);
    expect(a < b).toBe(true);
  });

  it('round-trips the timestamp', () => {
    const t = 1700000000000;
    expect(ulidTime(ulid(t))).toBe(t);
  });

  it('is unique across calls', () => {
    const ids = new Set(Array.from({ length: 10000 }, () => ulid()));
    expect(ids.size).toBe(10000);
  });

  it('rejects malformed ids', () => {
    expect(isUlid('not-a-ulid')).toBe(false);
  });
});

describe('normalizeTitle', () => {
  it('lowercases and trims', () => {
    expect(normalizeTitle('  Shape of YOU  ')).toBe('shape of you');
  });

  it('strips diacritics', () => {
    expect(normalizeTitle('Café')).toBe('cafe');
  });

  it('collapses punctuation and whitespace', () => {
    expect(normalizeTitle("Don't Stop  — Me Now")).toBe('don t stop me now');
  });
});

describe('normalizeArtist', () => {
  it('unifies "and" and "&"', () => {
    expect(normalizeArtist('ACDC')).toBe('acdc');
    expect(normalizeArtist('AC/DC')).toBe('ac dc');
  });

  it('drops leading "The"', () => {
    expect(normalizeArtist('The Beatles')).toBe('beatles');
  });

  it('strips diacritics', () => {
    expect(normalizeArtist('Beyoncé')).toBe('beyonce');
  });
});

describe('stripVersion', () => {
  it('removes parenthetical version labels', () => {
    expect(stripVersion('Shape of You (Remix)')).toBe('Shape of You');
  });

  it('removes featured artist suffix', () => {
    expect(stripVersion('Closer (feat. Halsey)')).toBe('Closer');
  });

  it('keeps the base title', () => {
    expect(stripVersion('Bohemian Rhapsody')).toBe('Bohemian Rhapsody');
  });
});

describe('levenshteinSimilarity', () => {
  it('is 1 for identical strings', () => {
    expect(levenshteinSimilarity('shape of you', 'shape of you')).toBe(1);
  });

  it('handles misspellings', () => {
    expect(levenshteinSimilarity('shape of yu', 'shape of you')).toBeGreaterThan(0.8);
  });

  it('is 0 for empty a', () => {
    expect(levenshteinSimilarity('', 'shape')).toBe(0);
  });
});

describe('durationsCompatible', () => {
  it('accepts close durations', () => {
    expect(durationsCompatible(235000, 238000)).toBe(true);
  });

  it('rejects wildly different durations', () => {
    expect(durationsCompatible(60000, 300000)).toBe(false);
  });

  it('treats unknown durations as compatible', () => {
    expect(durationsCompatible(undefined, 235000)).toBe(true);
  });
});

describe('trackFingerprint', () => {
  it('produces stable fingerprint regardless of artist order', () => {
    const a = trackFingerprint('Closer (feat. Halsey)', ['The Chainsmokers', 'Halsey']);
    const b = trackFingerprint('Closer', ['Halsey', 'The Chainsmokers']);
    expect(a).toBe(b);
  });

  it('differentiates different tracks', () => {
    const a = trackFingerprint('Shape of You', ['Ed Sheeran']);
    const b = trackFingerprint('Shape of My Heart', ['Sting']);
    expect(a).not.toBe(b);
  });
});
