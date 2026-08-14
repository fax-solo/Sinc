import { describe, it, expect } from 'vitest';
import {
  SearchScorer,
  parseQuery,
  titleScore,
  artistScore,
  albumScore,
  durationScore,
  isrcScore,
  versionScore,
  normalizePopularity,
  type NormalizedQuery,
} from '../domain/catalog/search-scorer.js';

const raw = (overrides: Record<string, unknown> = {}) => ({
  provider: 'musicbrainz',
  providerId: 'rec-1',
  title: 'Hotel California',
  artistNames: ['Eagles'],
  ...overrides,
});

describe('titleScore', () => {
  it('scores exact normalized match 1.0', () => {
    expect(titleScore('hotel california', 'Hotel California')).toBe(1);
  });

  it('scores substring match 0.9', () => {
    expect(titleScore('hotel', 'Hotel California')).toBe(0.9);
  });

  it('scores query-longer match 0.7', () => {
    expect(titleScore('Hotel California', 'hotel')).toBe(0.7);
  });

  it('fuzzy match scales with distance', () => {
    const score = titleScore('Hotel Californa', 'Hotel California');
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThan(1);
  });

  it('ignores case and diacritics', () => {
    expect(titleScore('café', 'Cafe')).toBe(1);
  });
});

describe('artistScore', () => {
  it('scores exact match 1.0 with and/& normalization', () => {
    expect(artistScore('Guns & Roses', ['Guns and Roses'])).toBe(1);
  });

  it('matches the best of multiple artists', () => {
    expect(artistScore('Adele', ['Someone Else', 'Adele'])).toBe(1);
  });

  it('returns 0 when no artists are known', () => {
    expect(artistScore('Eagles', [])).toBe(0);
  });

  it('partial match below exact', () => {
    const score = artistScore('Eagle', ['Eagles']);
    expect(score).toBeGreaterThan(0.8);
    expect(score).toBeLessThan(1);
  });
});

describe('albumScore', () => {
  it('neutral when no album in query or result', () => {
    expect(albumScore(undefined, undefined)).toBe(0.5);
    expect(albumScore('hotel', undefined)).toBe(0.5);
    expect(albumScore(undefined, 'Hotel California')).toBe(0.5);
  });

  it('exact match 1.0', () => {
    expect(albumScore('hotel california', 'Hotel California')).toBe(1);
  });
});

describe('durationScore', () => {
  it('exact match 1.0', () => {
    expect(durationScore(391000, 391000)).toBe(1);
  });

  it('within 5% tolerance scores 0.8', () => {
    expect(durationScore(391000, 391500)).toBe(0.8);
  });

  it('conflicting durations score 0', () => {
    expect(durationScore(120000, 391000)).toBe(0);
  });

  it('neutral when a side is unknown', () => {
    expect(durationScore(undefined, 391000)).toBe(0.5);
    expect(durationScore(391000, undefined)).toBe(0.5);
  });
});

describe('isrcScore', () => {
  it('case-insensitive match 1.0', () => {
    expect(isrcScore('usmc17638786', 'USMC17638786')).toBe(1);
  });

  it('no isrc on result scores 0 when queried', () => {
    expect(isrcScore('USMC17638786', undefined)).toBe(0);
  });

  it('neutral when no isrc in query', () => {
    expect(isrcScore(undefined, 'USMC17638786')).toBe(0.5);
  });
});

describe('versionScore', () => {
  it('neutral when both sides are plain', () => {
    expect(versionScore(undefined, undefined)).toBe(1);
  });

  it('matching versions score 1', () => {
    expect(versionScore('remix', 'Remix')).toBe(1);
  });

  it('version conflict scores 0', () => {
    expect(versionScore('acoustic', 'live')).toBe(0);
  });

  it('half credit when only one side has a version', () => {
    expect(versionScore('remix', undefined)).toBe(0.6);
  });
});

describe('normalizePopularity', () => {
  it('clamps into [0,1]', () => {
    expect(normalizePopularity(80)).toBe(0.8);
    expect(normalizePopularity(100)).toBe(1);
    expect(normalizePopularity(120)).toBe(1);
    expect(normalizePopularity(0)).toBe(0.5);
    expect(normalizePopularity(undefined)).toBe(0.5);
  });
});

describe('SearchScorer', () => {
  it('prefers an exact title+artist match over a fuzzy one', () => {
    const scorer = new SearchScorer();
    const query = parseQuery('Hotel California', { artist: 'Eagles' });
    const exact = scorer.score(query, raw());
    const fuzzy = scorer.score(query, raw({ title: 'Hotel Calif.', artistNames: ['The Eagles'] }));
    expect(exact.total).toBeGreaterThan(fuzzy.total);
  });

  it('isrc match dominates a fuzzy title', () => {
    const scorer = new SearchScorer();
    const query: NormalizedQuery = {
      title: 'Hotel Californa',
      artist: 'Eagles',
      isrc: 'USMC17638786',
    };
    const withIsrc = scorer.score(query, raw({ title: 'Hotel Californa', isrc: 'USMC17638786' }));
    const withoutIsrc = scorer.score(query, raw({ isrc: undefined }));
    expect(withIsrc.total).toBeGreaterThan(withoutIsrc.total);
  });

  it('weights always sum so total stays in [0,1]', () => {
    const scorer = new SearchScorer();
    const query = parseQuery('xyz');
    for (const result of [
      raw({ title: 'xyz', isrc: 'X' }),
      raw({ title: 'nope', artistNames: [] }),
      raw({}),
    ]) {
      const { total } = scorer.score(query, result);
      expect(total).toBeGreaterThanOrEqual(0);
      expect(total).toBeLessThanOrEqual(1);
    }
  });

  it('exposes a breakdown with all components', () => {
    const scorer = new SearchScorer();
    const breakdown = scorer.score(parseQuery('hotel'), raw());
    expect(breakdown).toMatchObject({
      total: expect.any(Number),
      titleScore: expect.any(Number),
      artistScore: expect.any(Number),
      albumScore: expect.any(Number),
      durationScore: expect.any(Number),
      isrcScore: expect.any(Number),
      versionScore: expect.any(Number),
      popularityScore: expect.any(Number),
      providerScore: expect.any(Number),
    });
  });
});
