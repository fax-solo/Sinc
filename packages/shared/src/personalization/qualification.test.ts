import { describe, expect, it } from 'vitest';
import {
  isEarlySkip,
  isReplay,
  isShortTrack,
  qualifiesAsCompletion,
  qualifiesAsMeaningfulPlay,
  getReachedCheckpoints,
} from './qualification.js';

describe('Play Qualification Policy', () => {
  describe('isShortTrack', () => {
    it('identifies tracks under 30s as short tracks', () => {
      expect(isShortTrack(15_000)).toBe(true);
      expect(isShortTrack(29_999)).toBe(true);
      expect(isShortTrack(30_000)).toBe(false);
      expect(isShortTrack(210_000)).toBe(false);
      expect(isShortTrack(0)).toBe(false);
    });
  });

  describe('qualifiesAsMeaningfulPlay', () => {
    it('qualifies a standard track after 30 seconds of actual listening', () => {
      const trackDuration = 180_000; // 3 min
      expect(qualifiesAsMeaningfulPlay(10_000, trackDuration)).toBe(false);
      expect(qualifiesAsMeaningfulPlay(29_999, trackDuration)).toBe(false);
      expect(qualifiesAsMeaningfulPlay(30_000, trackDuration)).toBe(true);
      expect(qualifiesAsMeaningfulPlay(60_000, trackDuration)).toBe(true);
    });

    it('qualifies short tracks (<30s) using the short-track threshold (70%)', () => {
      const shortTrackDuration = 20_000; // 20s
      // 70% of 20s is 14s (14,000ms)
      expect(qualifiesAsMeaningfulPlay(10_000, shortTrackDuration)).toBe(false);
      expect(qualifiesAsMeaningfulPlay(13_999, shortTrackDuration)).toBe(false);
      expect(qualifiesAsMeaningfulPlay(14_000, shortTrackDuration)).toBe(true);
      expect(qualifiesAsMeaningfulPlay(19_000, shortTrackDuration)).toBe(true);
    });

    it('handles tracks with unknown duration (0) by requiring 30s', () => {
      expect(qualifiesAsMeaningfulPlay(25_000, 0)).toBe(false);
      expect(qualifiesAsMeaningfulPlay(30_000, 0)).toBe(true);
    });

    it('rejects 0 or negative actual listen duration', () => {
      expect(qualifiesAsMeaningfulPlay(0, 180_000)).toBe(false);
      expect(qualifiesAsMeaningfulPlay(-500, 180_000)).toBe(false);
    });
  });

  describe('qualifiesAsCompletion', () => {
    it('qualifies when reaching >= 90% actual playback', () => {
      const trackDuration = 200_000;
      expect(qualifiesAsCompletion(170_000, 170_000, trackDuration)).toBe(false); // 85%
      expect(qualifiesAsCompletion(180_000, 180_000, trackDuration)).toBe(true); // 90%
    });

    it('does NOT qualify as completion if user seeked to the end without listening', () => {
      const trackDuration = 200_000;
      // User seeked to 198,000ms but only actually listened for 4,000ms
      expect(qualifiesAsCompletion(4_000, 198_000, trackDuration)).toBe(false);
    });

    it('qualifies short track when reaching >= 90% actual playback', () => {
      const shortTrackDuration = 10_000;
      expect(qualifiesAsCompletion(8_000, 8_000, shortTrackDuration)).toBe(false);
      expect(qualifiesAsCompletion(9_000, 9_000, shortTrackDuration)).toBe(true);
    });
  });

  describe('isEarlySkip', () => {
    it('identifies skips before 30s as early skips', () => {
      const trackDuration = 180_000;
      expect(isEarlySkip(10_000, 10_000, trackDuration)).toBe(true);
      expect(isEarlySkip(20_000, 20_000, trackDuration)).toBe(true);
    });

    it('identifies skips after 30s as late transitions (not early skips)', () => {
      const trackDuration = 180_000;
      expect(isEarlySkip(35_000, 35_000, trackDuration)).toBe(false);
      expect(isEarlySkip(150_000, 150_000, trackDuration)).toBe(false);
    });
  });

  describe('isReplay', () => {
    it('detects a replay of the same track within 5 minutes', () => {
      const trackId = 'track-1';
      const now = 1000_000;
      expect(isReplay(trackId, trackId, now - 60_000, now)).toBe(true); // 1 min later
      expect(isReplay(trackId, trackId, now - 299_000, now)).toBe(true); // 4.9 min later
    });

    it('rejects replay if different track', () => {
      const now = 1000_000;
      expect(isReplay('track-1', 'track-2', now - 30_000, now)).toBe(false);
    });

    it('rejects replay if beyond the replay window (>5 min)', () => {
      const trackId = 'track-1';
      const now = 1000_000;
      expect(isReplay(trackId, trackId, now - 360_000, now)).toBe(false); // 6 min later
    });
  });

  describe('getReachedCheckpoints', () => {
    it('returns newly reached progress checkpoints without duplicates', () => {
      const trackDuration = 100_000;
      const reached = new Set<number>();

      // At 10s (10%), no checkpoints reached
      expect(getReachedCheckpoints(10_000, trackDuration, reached)).toEqual([]);

      // At 30s (30%), 0.25 checkpoint reached
      const first = getReachedCheckpoints(30_000, trackDuration, reached);
      expect(first).toEqual([0.25]);
      first.forEach((c: number) => reached.add(c));

      // At 35s, 0.25 already reached, none new
      expect(getReachedCheckpoints(35_000, trackDuration, reached)).toEqual([]);

      // At 55s (55%), 0.50 checkpoint reached
      const second = getReachedCheckpoints(55_000, trackDuration, reached);
      expect(second).toEqual([0.50]);
      second.forEach((c: number) => reached.add(c));

      // At 85s (85%), 0.75 reached
      const third = getReachedCheckpoints(85_000, trackDuration, reached);
      expect(third).toEqual([0.75]);
    });
  });
});
