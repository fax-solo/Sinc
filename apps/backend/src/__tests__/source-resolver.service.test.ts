import { describe, expect, it } from 'vitest';
import type { CanonicalTrack, SourceCandidate } from '@sinc/shared';
import {
  SourceResolverService,
  DEFAULT_RESOLVER_CONFIG,
} from '../domain/playback/source-resolver.service.js';

function track(overrides: Partial<CanonicalTrack> = {}): CanonicalTrack {
  return {
    id: 'T1',
    title: 'Bohemian Rhapsody',
    normalizedTitle: 'bohemian rhapsody',
    artists: [{ id: 'A1', name: 'Queen' }],
    durationMs: 354_000,
    isrc: 'GBUM71029604',
    providerIds: { musicbrainz: 'mb-1' },
    providerConfidence: 0.95,
    ...overrides,
  };
}

function candidate(overrides: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    provider: 'provider-a',
    externalId: 'p1',
    title: 'Bohemian Rhapsody',
    artistNames: ['Queen'],
    durationMs: 354_000,
    isrc: 'GBUM71029604',
    url: 'https://cdn.example/p1.mp3',
    format: 'mp3',
    licenseType: 'permitted',
    ...overrides,
  };
}

describe('SourceResolverService', () => {
  const resolver = new SourceResolverService();

  describe('ISRC-first scoring', () => {
    it('scores an exact ISRC match at 1.0', () => {
      expect(resolver.score(track(), candidate())).toBe(1);
    });

    it('is case-insensitive and unaffected by title differences', () => {
      const score = resolver.score(
        track(),
        candidate({ isrc: 'gbum71029604', title: 'Bohemian Rhapsody (Live)' }),
      );
      expect(score).toBe(1);
    });

    it('never scores an ISRC mismatch as high as an exact match', () => {
      const isrcScore = resolver.score(track(), candidate());
      const titleOnlyScore = resolver.score(
        track(),
        candidate({ isrc: undefined, artistNames: ['Wrong Artist'] }),
      );
      expect(isrcScore).toBeGreaterThan(titleOnlyScore);
    });
  });

  describe('title/artist/duration similarity', () => {
    it('scores a title+artist+duration match at 1.0 without ISRC', () => {
      const score = resolver.score(track(), candidate({ isrc: undefined }));
      expect(score).toBe(1);
    });

    it('penalizes a wrong artist', () => {
      const score = resolver.score(
        track(),
        candidate({ isrc: undefined, artistNames: ['Some Other Band'] }),
      );
      expect(score).toBeLessThan(1);
    });

    it('penalizes a far-off duration', () => {
      const score = resolver.score(track(), candidate({ isrc: undefined, durationMs: 90_000 }));
      expect(score).toBeLessThan(1);
    });

    it('tolerates small duration drift within the tolerance window', () => {
      const score = resolver.score(track(), candidate({ isrc: undefined, durationMs: 354_500 }));
      expect(score).toBe(1);
    });
  });

  describe('provider reliability', () => {
    it('scales the score down for an unreliable provider', () => {
      const reliable = resolver.score(track(), candidate({ sourceReliability: 1 }));
      const flaky = resolver.score(track(), candidate({ sourceReliability: 0.3 }));
      expect(flaky).toBeLessThan(reliable);
    });

    it('rejects an exact ISRC match from a very unreliable provider', () => {
      const resolved = resolver.resolve(track(), [candidate({ sourceReliability: 0.2 })]);
      expect(resolved).toBeNull();
    });
  });

  describe('resolve (never auto-selects low-confidence)', () => {
    it('picks the best candidate when above the threshold', () => {
      const resolved = resolver.resolve(track(), [
        candidate({
          externalId: 'exact',
          isrc: 'GBUM71029604',
          url: 'https://cdn.example/exact.mp3',
        }),
        candidate({
          externalId: 'similar',
          isrc: undefined,
          url: 'https://cdn.example/similar.mp3',
        }),
      ]);
      expect(resolved).not.toBeNull();
      expect(resolved!.provider).toBe('provider-a');
      expect(resolved!.confidence).toBeGreaterThanOrEqual(DEFAULT_RESOLVER_CONFIG.minConfidence);
    });

    it('returns null when every candidate is below the threshold', () => {
      const resolved = resolver.resolve(track(), [
        candidate({ isrc: undefined, artistNames: ['Wrong Artist'], durationMs: 10_000 }),
      ]);
      expect(resolved).toBeNull();
    });

    it('returns null for an empty candidate list', () => {
      expect(resolver.resolve(track(), [])).toBeNull();
    });

    it('returns null when the winning candidate has no URL', () => {
      const resolved = resolver.resolve(track(), [candidate({ url: undefined })]);
      expect(resolved).toBeNull();
    });
  });
});
