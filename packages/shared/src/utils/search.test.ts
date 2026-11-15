import { describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '../types/index.js';
import {
  detectVersion,
  extractBaseStem,
  levenshteinDistance,
  mergeAndDedupeTracks,
  parseQuery,
  rankPersonalizedTracks,
  scoreTrack,
  stringSimilarity,
} from './search.js';
import { compactText, isNonLatin, normalizeText } from './text.js';

const mockTrack = (
  id: string,
  title: string,
  artist: string,
  durationMs = 200000,
  provider = 'itunes'
): CanonicalTrack => ({
  id: `${provider}:${id}`,
  title,
  artists: [{ id: `${provider}:${artist}`, name: artist, providerIds: {}, genres: [] }],
  album: {
    id: `${provider}:alb-${id}`,
    title: 'Album',
    artist: { id: `${provider}:${artist}`, name: artist, providerIds: {}, genres: [] },
    trackCount: 1,
    providerIds: {},
    type: 'album',
  },
  durationMs,
  providerIds: { [provider]: id },
  explicit: false,
});

describe('Text Normalization and Script Utilities', () => {
  it('normalizes diacritics, case, and extra whitespace', () => {
    expect(normalizeText('  Beyoncé -   Halo  ')).toBe('beyonce halo');
  });

  it('folds Arabic letter variants (teh marbuta, alef maqsura) and removes tatweel', () => {
    // ة -> ه, ى -> ي, ـ (tatweel) removed
    expect(normalizeText('شيرين ـ كدابين')).toBe('شيرين كدابين');
    expect(normalizeText('مَكَانَك')).toBe('مكانك');
    expect(normalizeText('فاطمة')).toBe('فاطمه');
    expect(normalizeText('منى')).toBe('مني');
  });

  it('compacts text by stripping non-alphanumerics and spaces', () => {
    expect(compactText('OT$HA')).toBe('otsha');
    expect(compactText('OT-SHA')).toBe('otsha');
    expect(compactText('ot sha')).toBe('otsha');
  });

  it('detects non-Latin scripts accurately', () => {
    expect(isNonLatin('Amr Diab')).toBe(false);
    expect(isNonLatin('عمرو دياب')).toBe(true);
    expect(isNonLatin('The Weeknd كدابين')).toBe(true);
    expect(isNonLatin('히든')).toBe(true);
  });
});

describe('Search Query Parsing and Version Detection', () => {
  it('parses simple queries', () => {
    const q = parseQuery('Blinding Lights');
    expect(q.tokens).toEqual(['blinding', 'lights']);
    expect(q.hasArtistSeparator).toBe(false);
    expect(q.requestedVersion).toBeUndefined();
  });

  it('extracts structured artist and title hints on separator', () => {
    const q = parseQuery('After Dark - Mr.Kitty');
    expect(q.hasArtistSeparator).toBe(true);
    expect(q.titleHint).toBe('after dark');
    expect(q.artistHint).toBe('mr kitty');
  });

  it('detects requested version tags', () => {
    expect(detectVersion('After Dark (Remix)')).toBe('remix');
    expect(detectVersion('Hotel California Live')).toBe('live');
    expect(detectVersion('Shape of You Acoustic')).toBe('acoustic');
    expect(detectVersion('Standard Studio Cut')).toBeNull();
  });

  it('extracts base stems by stripping version tags and parentheticals', () => {
    expect(extractBaseStem('After Dark (Remix)')).toBe('after dark');
    expect(extractBaseStem('Hotel California [Live at the Forum]')).toBe('hotel california');
  });

  it('calculates string similarity and Levenshtein distance correctly', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(stringSimilarity('Blinding Lights', 'Blinding Lights')).toBe(1.0);
    expect(stringSimilarity('Blind Light', 'Blinding Lights')).toBeGreaterThan(0.65);
  });
});

describe('Multi-Factor Scoring and Confidence Handling', () => {
  it('gives high confidence and high score to compound queries (Artist - Title)', () => {
    const track = mockTrack('1', 'After Dark', 'Mr.Kitty');
    const scored = scoreTrack('After Dark - Mr.Kitty', track);
    expect(scored.score).toBeGreaterThanOrEqual(120);
    expect(scored.confidence).toBe('high');
    expect(scored.matchReasons.some((r) => r.includes('artist_and_title_combo'))).toBe(true);
  });

  it('rewards requested remix version over original cut', () => {
    const original = mockTrack('orig', 'After Dark', 'Mr.Kitty');
    const remix = mockTrack('remix', 'After Dark (Remix)', 'Mr.Kitty');

    const scoredOrig = scoreTrack('After Dark Remix', original);
    const scoredRemix = scoreTrack('After Dark Remix', remix);

    expect(scoredRemix.score).toBeGreaterThan(scoredOrig.score);
    expect(scoredRemix.confidence).toBe('high');
  });

  it('penalizes unrequested remix or live version when user wants the clean original', () => {
    const studio = mockTrack('studio', 'Hotel California', 'Eagles');
    const live = mockTrack('live', 'Hotel California (Live)', 'Eagles');

    const scoredStudio = scoreTrack('Hotel California', studio);
    const scoredLive = scoreTrack('Hotel California', live);

    expect(scoredStudio.score).toBeGreaterThan(scoredLive.score);
  });

  it('matches Arabic titles with diacritics and variants', () => {
    const track = mockTrack('ar-1', 'مَكَانَك', 'عمرو دياب');
    const scored = scoreTrack('مكانك', track);
    expect(scored.score).toBeGreaterThanOrEqual(100);
    expect(scored.confidence).toBe('high');
  });
});

describe('Smart Deduplication and Provider ID Merging', () => {
  it('merges identical tracks from iTunes and Deezer, preserving both providerIds', () => {
    const itunesTrack = mockTrack('100', 'Blinding Lights', 'The Weeknd', 200000, 'itunes');
    const deezerTrack = mockTrack('200', 'Blinding Lights', 'The Weeknd', 201000, 'deezer');

    const merged = mergeAndDedupeTracks([itunesTrack, deezerTrack]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.providerIds).toEqual({
      itunes: '100',
      deezer: '200',
    });
  });

  it('does NOT merge distinct versions (original vs remix)', () => {
    const original = mockTrack('1', 'After Dark', 'Mr.Kitty', 259000, 'itunes');
    const remix = mockTrack('2', 'After Dark (Remix)', 'Mr.Kitty', 265000, 'itunes');

    const merged = mergeAndDedupeTracks([original, remix]);
    expect(merged).toHaveLength(2);
  });
});

describe('Personalized Search Ranking', () => {
  it('gives affinity boost to favorite/played tracks among relevant results', () => {
    const trackA = mockTrack('1', 'Starboy', 'The Weeknd');
    const trackB = mockTrack('2', 'Starboy (Remix)', 'The Weeknd');

    // Both match query "Starboy", but trackA is a favorite
    const ranked = rankPersonalizedTracks('Starboy', [trackB, trackA], {
      favoriteTrackIds: new Set(['itunes:1']),
      playedTrackIds: new Set(['itunes:1']),
      enabled: true,
    });

    expect(ranked[0]?.track.id).toBe('itunes:1');
    expect(ranked[0]?.matchReasons.some((r) => r.startsWith('personal_affinity'))).toBe(true);
  });

  it('NEVER allows an unrelated favorite song to outrank an exact match', () => {
    const exactMatch = mockTrack('1', 'Hotel California', 'Eagles');
    const unrelatedFav = mockTrack('2', 'California Love', '2Pac');

    const ranked = rankPersonalizedTracks('Hotel California', [unrelatedFav, exactMatch], {
      favoriteTrackIds: new Set(['itunes:2']), // user loves 2Pac
      favoriteArtistNames: new Set(['2pac']),
      enabled: true,
    });

    // Exact match must still be #1!
    expect(ranked[0]?.track.id).toBe('itunes:1');
    expect(ranked[0]?.track.title).toBe('Hotel California');
  });

  it('ignores personalization when disabled', () => {
    const trackA = mockTrack('1', 'Starboy', 'The Weeknd');
    const trackB = mockTrack('2', 'Starboy', 'The Weeknd');

    const ranked = rankPersonalizedTracks('Starboy', [trackA, trackB], {
      favoriteTrackIds: new Set(['itunes:2']),
      enabled: false,
    });

    expect(ranked[0]?.matchReasons.some((r) => r.startsWith('personal_affinity'))).toBe(false);
  });
});

