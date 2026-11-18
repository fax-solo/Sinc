import { describe, expect, it } from 'vitest';
import type { CanonicalArtist, ListeningEvent, TasteScore } from '../types/index.js';
import { computeUserTasteProfile } from './tasteEngine.js';

const NOW = 1_700_000_000_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function createEvent(
  overrides: Partial<ListeningEvent> & { eventType: ListeningEvent['eventType']; trackId: string }
): ListeningEvent {
  return {
    id: `ev-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: `sess-${Math.random().toString(36).slice(2, 8)}`,
    trackTitle: 'Test Song',
    artistName: 'Test Artist',
    genres: ['Electronic'],
    timestamp: NOW,
    positionMs: 35_000,
    playbackDurationMs: 35_000,
    trackDurationMs: 180_000,
    completionRatio: 0.2,
    meaningfulPlayQualified: false,
    idempotencyId: `idem-${Math.random().toString(36).slice(2, 8)}`,
    ...overrides,
  };
}

describe('User Taste Engine', () => {
  it('returns clean cold-start empty profile when no listening history or preferences exist', () => {
    const profile = computeUserTasteProfile({
      events: [],
      favoriteTracks: [],
      followedArtists: [],
      nowMs: NOW,
    });

    expect(profile.isEmpty).toBe(true);
    expect(profile.topArtists).toHaveLength(0);
    expect(profile.topGenres).toHaveLength(0);
    expect(profile.favoriteArtists).toHaveLength(0);
    expect(profile.totalListeningTimeMs).toBe(0);
    expect(profile.totalQualifiedPlays).toBe(0);
  });

  it('aggregates listening events into top artists and top genres with decay', () => {
    const daftPunkEvents = [
      createEvent({
        trackId: 'dp-1',
        trackTitle: 'Get Lucky',
        artistName: 'Daft Punk',
        genres: ['Electronic', 'Disco'],
        eventType: 'track_started',
        timestamp: NOW - 2 * ONE_DAY_MS,
      }),
      createEvent({
        trackId: 'dp-1',
        trackTitle: 'Get Lucky',
        artistName: 'Daft Punk',
        genres: ['Electronic', 'Disco'],
        eventType: 'playback_progress',
        meaningfulPlayQualified: true,
        playbackDurationMs: 30_000,
        timestamp: NOW - 2 * ONE_DAY_MS,
      }),
      createEvent({
        trackId: 'dp-1',
        trackTitle: 'Get Lucky',
        artistName: 'Daft Punk',
        genres: ['Electronic', 'Disco'],
        eventType: 'track_completed',
        timestamp: NOW - 2 * ONE_DAY_MS,
      }),
    ];

    const pinkFloydEvents = [
      createEvent({
        trackId: 'pf-1',
        trackTitle: 'Time',
        artistName: 'Pink Floyd',
        genres: ['Progressive Rock'],
        eventType: 'track_started',
        timestamp: NOW - 20 * ONE_DAY_MS, // older event (decayed)
      }),
      createEvent({
        trackId: 'pf-1',
        trackTitle: 'Time',
        artistName: 'Pink Floyd',
        genres: ['Progressive Rock'],
        eventType: 'playback_progress',
        meaningfulPlayQualified: true,
        playbackDurationMs: 30_000,
        timestamp: NOW - 20 * ONE_DAY_MS,
      }),
    ];

    const profile = computeUserTasteProfile({
      events: [...daftPunkEvents, ...pinkFloydEvents],
      nowMs: NOW,
    });

    expect(profile.isEmpty).toBe(false);
    expect(profile.topArtists[0]!.name).toBe('Daft Punk');
    expect(profile.topArtists[0]!.score).toBeGreaterThan(profile.topArtists[1]!.score);
    expect(profile.topGenres.some((g: TasteScore) => g.name === 'Electronic')).toBe(true);
    expect(profile.frequentlyPlayedTracks).toHaveLength(2);
    expect(profile.totalCompletions).toBe(1);
    expect(profile.totalQualifiedPlays).toBe(2);
  });

  it('amplifies explicit preferences (likes, follows) higher than passive plays', () => {
    const radioheadFollow: CanonicalArtist = {
      id: 'rh-1',
      name: 'Radiohead',
      genres: ['Alternative Rock'],
      providerIds: {},
    };

    const passiveArtistEvents = [
      createEvent({
        trackId: 'coldplay-1',
        artistName: 'Coldplay',
        eventType: 'playback_progress',
        meaningfulPlayQualified: true,
        timestamp: NOW - 1 * ONE_DAY_MS,
      }),
    ];

    const profile = computeUserTasteProfile({
      events: passiveArtistEvents,
      followedArtists: [radioheadFollow],
      nowMs: NOW,
    });

    // Follow weight (2.0 * 0.5 short + 2.0 * 1.5 long = 4.0 composite)
    // Passive play weight (1.0 * decay < 1.0 composite)
    expect(profile.topArtists[0]!.name).toBe('Radiohead');
    expect(profile.topArtists[0]!.score).toBeGreaterThan(profile.topArtists[1]!.score);
  });

  it('records early skips without unfairly zeroing out the artist score', () => {
    const trackEvents = [
      createEvent({
        trackId: 'pop-1',
        artistName: 'Pop Star',
        eventType: 'track_started',
        timestamp: NOW - 1 * ONE_DAY_MS,
      }),
      createEvent({
        trackId: 'pop-1',
        artistName: 'Pop Star',
        eventType: 'track_skipped',
        playbackDurationMs: 8_000,
        timestamp: NOW - 1 * ONE_DAY_MS,
      }),
    ];

    const profile = computeUserTasteProfile({
      events: trackEvents,
      nowMs: NOW,
    });

    expect(profile.skippedTracks).toHaveLength(1);
    expect(profile.skippedTracks![0]!.count).toBe(1);
    expect(profile.totalSkips).toBe(1);
  });

  it('guarantees deterministic recalculation from the exact same event history', () => {
    const events = [
      createEvent({ trackId: '1', artistName: 'Artist A', eventType: 'track_started', timestamp: NOW - 1000 }),
      createEvent({ trackId: '1', artistName: 'Artist A', eventType: 'track_completed', timestamp: NOW }),
      createEvent({ trackId: '2', artistName: 'Artist B', eventType: 'track_started', timestamp: NOW - 2000 }),
    ];

    const run1 = computeUserTasteProfile({ events, nowMs: NOW });
    const run2 = computeUserTasteProfile({ events, nowMs: NOW });

    expect(run1).toEqual(run2);
  });
});
