import { describe, expect, it } from 'vitest';
import type { CanonicalArtist, CanonicalTrack, ListeningEvent } from '@sinc/shared';
import {
  computeTasteProfile,
  computeListeningInsights,
  mapDiscoveryMode,
  discoveryPreferenceForMode,
  TASTE_WEIGHTS,
} from './tasteProfile';

const NOW = 1700000000000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function mockArtist(name: string, genres: string[] = ['rock']): CanonicalArtist {
  return {
    id: `art-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    genres,
    providerIds: {},
  };
}

function mockTrack(id: string, title: string, artistName: string): CanonicalTrack {
  return {
    id,
    title,
    artists: [mockArtist(artistName)],
    durationMs: 210000,
    providerIds: {},
    explicit: false,
  };
}

describe('tasteProfile', () => {
  it('maps discovery mode and preference bidirectionally', () => {
    expect(mapDiscoveryMode(0.15)).toBe('familiar');
    expect(mapDiscoveryMode(0.5)).toBe('balanced');
    expect(mapDiscoveryMode(0.85)).toBe('exploration');

    expect(discoveryPreferenceForMode('familiar')).toBe(0.15);
    expect(discoveryPreferenceForMode('balanced')).toBe(0.5);
    expect(discoveryPreferenceForMode('exploration')).toBe(0.85);
  });

  it('cold start user: seeds profile from onboarding choices', () => {
    const profile = computeTasteProfile({
      events: [],
      playStats: {},
      skipStats: {},
      artistPlayStats: {},
      favoriteTracks: [],
      followedArtists: [],
      followedAlbums: [],
      downloadedTracks: [],
      initialFavoriteGenres: ['Rock', 'Electronic'],
      initialFavoriteArtists: ['Radiohead', 'Daft Punk'],
      nowMs: NOW,
    });

    expect(profile.personalizationEnabled).toBe(true);
    expect(profile.topArtists.some((a) => a.name === 'Radiohead')).toBe(true);
    expect(profile.topArtists.some((a) => a.name === 'Daft Punk')).toBe(true);
    expect(profile.topGenres.some((g) => g.name === 'Rock')).toBe(true);
    expect(profile.topGenres.some((g) => g.name === 'Electronic')).toBe(true);
  });

  it('honors personalization disabled', () => {
    const profile = computeTasteProfile({
      events: [],
      playStats: {},
      skipStats: {},
      artistPlayStats: { 'Pink Floyd': 50 },
      favoriteTracks: [mockTrack('t1', 'Time', 'Pink Floyd')],
      followedArtists: [mockArtist('Pink Floyd')],
      followedAlbums: [],
      downloadedTracks: [],
      personalizationEnabled: false,
      nowMs: NOW,
    });

    expect(profile.personalizationEnabled).toBe(false);
    expect(profile.topArtists).toHaveLength(0);
    expect(profile.topGenres).toHaveLength(0);
  });

  it('Rule 13: single skip is not treated as dislike, but repeated skips apply stronger downweighting', () => {
    // Artist with 5 completions and 1 early skip
    const eventsSingleSkip: ListeningEvent[] = [
      {
        id: 'e1',
        trackId: 't1',
        artistName: 'The Beatles',
        eventType: 'track_completed',
        timestamp: NOW - 2 * ONE_DAY_MS,
        playbackDurationMs: 200000,
        trackDurationMs: 200000,
        completionRatio: 1.0,
      },
      {
        id: 'e2',
        trackId: 't2',
        artistName: 'The Beatles',
        eventType: 'track_skipped',
        timestamp: NOW - ONE_DAY_MS,
        playbackDurationMs: 15000,
        trackDurationMs: 200000,
        completionRatio: 0.075,
      },
    ];

    const profileSingle = computeTasteProfile({
      events: eventsSingleSkip,
      playStats: {},
      skipStats: { t2: 1 },
      artistPlayStats: { 'The Beatles': 2 },
      favoriteTracks: [],
      followedArtists: [],
      followedAlbums: [],
      downloadedTracks: [],
      nowMs: NOW,
    });

    const beatlesSingle = profileSingle.topArtists.find((a) => a.name === 'The Beatles');
    expect(beatlesSingle).toBeDefined();
    // Artist score is still positive because 1 completion outweighs 1 early skip!
    expect(beatlesSingle!.score).toBeGreaterThan(0.2);

    // Now artist with 3 consecutive skips
    const eventsTripleSkip: ListeningEvent[] = [
      ...eventsSingleSkip,
      {
        id: 'e3',
        trackId: 't3',
        artistName: 'The Beatles',
        eventType: 'track_skipped',
        timestamp: NOW - ONE_DAY_MS + 1000,
        playbackDurationMs: 10000,
        trackDurationMs: 200000,
        completionRatio: 0.05,
      },
      {
        id: 'e4',
        trackId: 't4',
        artistName: 'The Beatles',
        eventType: 'track_skipped',
        timestamp: NOW - ONE_DAY_MS + 2000,
        playbackDurationMs: 12000,
        trackDurationMs: 200000,
        completionRatio: 0.06,
      },
    ];

    const profileTriple = computeTasteProfile({
      events: eventsTripleSkip,
      playStats: {},
      skipStats: { t2: 1, t3: 1, t4: 1 },
      artistPlayStats: { 'The Beatles': 2 },
      favoriteTracks: [],
      followedArtists: [],
      followedAlbums: [],
      downloadedTracks: [],
      nowMs: NOW,
    });

    const beatlesTriple = profileTriple.topArtists.find((a) => a.name === 'The Beatles');
    expect(beatlesTriple!.score).toBeLessThan(beatlesSingle!.score);
  });

  it('separates short-term vs long-term preference correctly', () => {
    // Artist A listened to 45 days ago (long term)
    // Artist B listened to repeatedly yesterday (short term spike)
    const events: ListeningEvent[] = [
      {
        id: 'e1',
        trackId: 't1',
        artistName: 'Old Favorite',
        eventType: 'track_completed',
        timestamp: NOW - 45 * ONE_DAY_MS,
        playbackDurationMs: 200000,
        trackDurationMs: 200000,
        completionRatio: 1.0,
      },
      {
        id: 'e2',
        trackId: 't2',
        artistName: 'Recent Discovery',
        eventType: 'track_completed',
        timestamp: NOW - 1 * ONE_DAY_MS,
        playbackDurationMs: 200000,
        trackDurationMs: 200000,
        completionRatio: 1.0,
      },
      {
        id: 'e3',
        trackId: 't3',
        artistName: 'Recent Discovery',
        eventType: 'track_completed',
        timestamp: NOW - 1 * ONE_DAY_MS + 200000,
        playbackDurationMs: 200000,
        trackDurationMs: 200000,
        completionRatio: 1.0,
      },
      {
        id: 'e4',
        trackId: 't4',
        artistName: 'Recent Discovery',
        eventType: 'track_completed',
        timestamp: NOW - 1 * ONE_DAY_MS + 400000,
        playbackDurationMs: 200000,
        trackDurationMs: 200000,
        completionRatio: 1.0,
      },
    ];

    const profile = computeTasteProfile({
      events,
      playStats: {},
      skipStats: {},
      artistPlayStats: { 'Old Favorite': 25, 'Recent Discovery': 3 },
      favoriteTracks: [mockTrack('t1', 'Classic', 'Old Favorite')],
      followedArtists: [mockArtist('Old Favorite')],
      followedAlbums: [],
      downloadedTracks: [],
      nowMs: NOW,
    });

    const oldFav = profile.topArtists.find((a) => a.name === 'Old Favorite')!;
    const recent = profile.topArtists.find((a) => a.name === 'Recent Discovery')!;

    expect(recent.shortTermScore).toBeGreaterThan(oldFav.shortTermScore);
    expect(oldFav.longTermScore).toBeGreaterThan(recent.longTermScore);
    // User does not lose their established music taste: Old Favorite remains in top artists
    expect(profile.topArtists[0].name).toBe('Old Favorite');
  });

  it('calculates verified listening insights without fabrication', () => {
    const events: ListeningEvent[] = [
      {
        id: 'e1',
        trackId: 't1',
        trackTitle: 'Song A',
        artistName: 'Artist 1',
        eventType: 'track_started',
        timestamp: NOW - 2 * ONE_DAY_MS,
        playbackDurationMs: 180000, // 3 mins
        trackDurationMs: 180000,
        completionRatio: 1.0,
        genres: ['Rock'],
      },
      {
        id: 'e2',
        trackId: 't1',
        trackTitle: 'Song A',
        artistName: 'Artist 1',
        eventType: 'track_completed',
        timestamp: NOW - 2 * ONE_DAY_MS + 180000,
        playbackDurationMs: 180000,
        trackDurationMs: 180000,
        completionRatio: 1.0,
        genres: ['Rock'],
      },
      {
        id: 'e3',
        trackId: 't2',
        trackTitle: 'Song B',
        artistName: 'Artist 2',
        eventType: 'track_started',
        timestamp: NOW - 15 * ONE_DAY_MS,
        playbackDurationMs: 0,
        trackDurationMs: 240000,
        completionRatio: 0,
        genres: ['Jazz'],
      },
      {
        id: 'e4',
        trackId: 't2',
        trackTitle: 'Song B',
        artistName: 'Artist 2',
        eventType: 'track_completed',
        timestamp: NOW - 15 * ONE_DAY_MS + 240000,
        playbackDurationMs: 240000, // 4 mins
        trackDurationMs: 240000,
        completionRatio: 1.0,
        genres: ['Jazz'],
      },
    ];

    // 7-day range: should only include Song A (3 min, 1 play, 1 completion)
    const insights7d = computeListeningInsights(events, {}, '7d', NOW);
    expect(insights7d.totalMinutes).toBe(3); // 180000 ms = 3 min
    expect(insights7d.playCount).toBe(1);
    expect(insights7d.topArtists[0].name).toBe('Artist 1');
    expect(insights7d.topGenres[0].name).toBe('Rock');

    // 30-day range: should include both Song A and Song B
    const insights30d = computeListeningInsights(events, {}, '30d', NOW);
    expect(insights30d.totalMinutes).toBe(7); // 3 min + 4 min
    expect(insights30d.playCount).toBe(2);
    expect(insights30d.topArtists).toHaveLength(2);
  });
});
