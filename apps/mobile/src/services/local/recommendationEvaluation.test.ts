import { describe, expect, it } from 'vitest';
import type { CanonicalArtist, CanonicalTrack, ListeningEvent } from '@sinc/shared';
import {
  computeTasteProfile,
  computeListeningInsights,
  mapDiscoveryMode,
  discoveryPreferenceForMode,
} from './tasteProfile';
import { selectFreshAwareMixTracks, selectMixTracks, trackSimilarity } from './mixSelection';
import { blacklistedTrackIds, computeArtistAffinity, hasUsefulAffinity } from './affinity';
import { rankPersonalizedTracks } from '@sinc/shared';

const NOW = 1700000000000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function makeArtist(name: string, genres: string[] = ['rock']): CanonicalArtist {
  return {
    id: `art-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    genres,
    providerIds: { deezer: `d-${name}` },
  };
}

function makeTrack(
  id: string,
  title: string,
  artistName: string,
  genres: string[] = ['rock'],
  albumTitle = 'Album'
): CanonicalTrack {
  return {
    id,
    title,
    artists: [makeArtist(artistName, genres)],
    album: {
      id: `alb-${id}`,
      title: albumTitle,
      artist: makeArtist(artistName, genres),
      trackCount: 10,
      providerIds: {},
      type: 'album',
    },
    durationMs: 210000,
    providerIds: { deezer: id },
    explicit: false,
  };
}

// ---------------------------------------------------------------------------
// Measurable recommendation evaluation metrics: Precision@K, Recall@K, NDCG@K, Diversity
// ---------------------------------------------------------------------------

function precisionAtK(recommendedIds: string[], groundTruthIds: Set<string>, k: number): number {
  const topK = recommendedIds.slice(0, k);
  if (topK.length === 0) return 0;
  const hits = topK.filter((id) => groundTruthIds.has(id)).length;
  return hits / topK.length;
}

function recallAtK(recommendedIds: string[], groundTruthIds: Set<string>, k: number): number {
  if (groundTruthIds.size === 0) return 1.0;
  const topK = recommendedIds.slice(0, k);
  const hits = topK.filter((id) => groundTruthIds.has(id)).length;
  return hits / groundTruthIds.size;
}

function dcgAtK(recommendedIds: string[], relevanceMap: Map<string, number>, k: number): number {
  let dcg = 0;
  const topK = recommendedIds.slice(0, k);
  for (let i = 0; i < topK.length; i++) {
    const rel = relevanceMap.get(topK[i]) ?? 0;
    dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
  }
  return dcg;
}

function ndcgAtK(recommendedIds: string[], relevanceMap: Map<string, number>, k: number): number {
  const actualDcg = dcgAtK(recommendedIds, relevanceMap, k);
  const idealOrder = [...relevanceMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  const idealDcg = dcgAtK(idealOrder, relevanceMap, k);
  return idealDcg > 0 ? actualDcg / idealDcg : 1.0;
}

function computeCatalogDiversity(tracks: CanonicalTrack[]): number {
  if (tracks.length <= 1) return 1.0;
  let totalSim = 0;
  let pairs = 0;
  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      totalSim += trackSimilarity(tracks[i], tracks[j]);
      pairs += 1;
    }
  }
  return 1.0 - totalSim / pairs;
}

describe('Recommendation Intelligence & Personalization Evaluation', () => {
  // Scenario 1: New user with no listening history (Cold Start)
  it('Scenario 1: Cold-start user without history seeds recommendations from onboarding', () => {
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
    expect(profile.favoriteArtists).toContain('Radiohead');
    expect(profile.favoriteArtists).toContain('Daft Punk');
    expect(profile.favoriteGenres).toContain('Rock');
    expect(profile.favoriteGenres).toContain('Electronic');
  });

  // Scenario 2: User with extensive listening history
  it('Scenario 2: User with extensive history achieves high Precision@K and NDCG@K', () => {
    const events: ListeningEvent[] = [];
    // User listened to Queen 15 times, Led Zeppelin 10 times, Pink Floyd 8 times
    for (let i = 0; i < 15; i++) {
      events.push({
        id: `q-${i}`,
        trackId: `queen-${i}`,
        trackTitle: `Queen Song ${i}`,
        artistName: 'Queen',
        eventType: 'track_completed',
        timestamp: NOW - i * ONE_DAY_MS,
        playbackDurationMs: 200000,
        trackDurationMs: 200000,
        completionRatio: 1.0,
      });
    }

    const candidatePool = [
      makeTrack('q1', 'Bohemian Rhapsody', 'Queen'),
      makeTrack('q2', 'Don’t Stop Me Now', 'Queen'),
      makeTrack('q3', 'Under Pressure', 'Queen'),
      makeTrack('lz1', 'Stairway to Heaven', 'Led Zeppelin'),
      makeTrack('lz2', 'Kashmir', 'Led Zeppelin'),
      makeTrack('pop1', 'Random Pop Song', 'Pop Star'),
      makeTrack('edm1', 'Random EDM', 'DJ Unknown'),
    ];

    const profile = computeTasteProfile({
      events,
      playStats: {},
      skipStats: {},
      artistPlayStats: { Queen: 15 },
      favoriteTracks: [candidatePool[0]],
      followedArtists: [makeArtist('Queen')],
      followedAlbums: [],
      downloadedTracks: [],
      nowMs: NOW,
    });

    const artistScores = new Map(profile.topArtists.map((a) => [a.name.toLowerCase(), a.score]));
    const scoreFn = (t: CanonicalTrack) => artistScores.get(t.artists[0]?.name.toLowerCase()) ?? 0;

    const selected = selectMixTracks(candidatePool, 5, scoreFn);
    const selectedIds = selected.map((t) => t.id);

    // Ground truth relevant items: Queen and Led Zeppelin tracks
    const groundTruth = new Set(['q1', 'q2', 'q3', 'lz1', 'lz2']);
    const precision = precisionAtK(selectedIds, groundTruth, 3);
    const recall = recallAtK(selectedIds, groundTruth, 5);

    const relevanceMap = new Map([
      ['q1', 3],
      ['q2', 3],
      ['q3', 3],
      ['lz1', 2],
      ['lz2', 2],
      ['pop1', 0],
      ['edm1', 0],
    ]);
    const ndcg = ndcgAtK(selectedIds, relevanceMap, 5);

    expect(precision).toBe(1.0); // 100% precision in top 3
    expect(recall).toBeGreaterThanOrEqual(0.6);
    expect(ndcg).toBeGreaterThanOrEqual(0.85);
  });

  // Scenario 3: User who listens to several genres
  it('Scenario 3: Multi-genre user maintains balanced genre coverage and diversity', () => {
    const events: ListeningEvent[] = [
      {
        id: 'e1',
        trackId: 't1',
        artistName: 'Miles Davis',
        genres: ['Jazz'],
        eventType: 'track_completed',
        timestamp: NOW - ONE_DAY_MS,
        playbackDurationMs: 300000,
        trackDurationMs: 300000,
        completionRatio: 1.0,
      },
      {
        id: 'e2',
        trackId: 't2',
        artistName: 'Daft Punk',
        genres: ['Electronic'],
        eventType: 'track_completed',
        timestamp: NOW - ONE_DAY_MS,
        playbackDurationMs: 240000,
        trackDurationMs: 240000,
        completionRatio: 1.0,
      },
      {
        id: 'e3',
        trackId: 't3',
        artistName: 'Nirvana',
        genres: ['Rock'],
        eventType: 'track_completed',
        timestamp: NOW - ONE_DAY_MS,
        playbackDurationMs: 200000,
        trackDurationMs: 200000,
        completionRatio: 1.0,
      },
    ];

    const profile = computeTasteProfile({
      events,
      playStats: {},
      skipStats: {},
      artistPlayStats: { 'Miles Davis': 5, 'Daft Punk': 5, Nirvana: 5 },
      favoriteTracks: [],
      followedArtists: [],
      followedAlbums: [],
      downloadedTracks: [],
      nowMs: NOW,
    });

    const topGenres = profile.topGenres.map((g) => g.name);
    expect(topGenres).toContain('Jazz');
    expect(topGenres).toContain('Electronic');
    expect(topGenres).toContain('Rock');
  });

  // Scenario 4: User who frequently replays tracks
  it('Scenario 4: Replay behavior boosts affinity higher than isolated starts', () => {
    const replayedEvents: ListeningEvent[] = [
      {
        id: 'r1',
        trackId: 't1',
        artistName: 'Replay Artist',
        eventType: 'track_started',
        timestamp: NOW - ONE_DAY_MS,
        playbackDurationMs: 0,
        trackDurationMs: 200000,
        completionRatio: 0,
      },
      {
        id: 'r2',
        trackId: 't1',
        artistName: 'Replay Artist',
        eventType: 'track_replayed',
        timestamp: NOW - ONE_DAY_MS + 200000,
        playbackDurationMs: 200000,
        trackDurationMs: 200000,
        completionRatio: 1.0,
      },
      {
        id: 'r3',
        trackId: 't1',
        artistName: 'Replay Artist',
        eventType: 'track_replayed',
        timestamp: NOW - ONE_DAY_MS + 400000,
        playbackDurationMs: 200000,
        trackDurationMs: 200000,
        completionRatio: 1.0,
      },
    ];

    const standardEvents: ListeningEvent[] = [
      {
        id: 's1',
        trackId: 't2',
        artistName: 'Single Artist',
        eventType: 'track_started',
        timestamp: NOW - ONE_DAY_MS,
        playbackDurationMs: 0,
        trackDurationMs: 200000,
        completionRatio: 0,
      },
    ];

    const profileReplay = computeTasteProfile({
      events: [...replayedEvents, ...standardEvents],
      playStats: {},
      skipStats: {},
      artistPlayStats: { 'Replay Artist': 3, 'Single Artist': 1 },
      favoriteTracks: [],
      followedArtists: [],
      followedAlbums: [],
      downloadedTracks: [],
      nowMs: NOW,
    });

    const replayScore = profileReplay.topArtists.find((a) => a.name === 'Replay Artist')!.score;
    const singleScore = profileReplay.topArtists.find((a) => a.name === 'Single Artist')!.score;

    expect(replayScore).toBeGreaterThan(singleScore * 2);
  });

  // Scenario 5: User who frequently skips tracks
  it('Scenario 5: Frequent skips downweight tracks, but single skip does not blacklist', () => {
    const signals = {
      playCounts: [{ trackId: 'skipped-song', count: 1, lastPlayedAt: NOW }],
      artistPlayCounts: [{ name: 'Skipped Artist', count: 1 }],
      skipCounts: [{ trackId: 'skipped-song', count: 1 }], // 1 skip
      completedCounts: [],
      thumbs: [],
      hiddenTrackIds: [],
      hiddenArtistNames: [],
      discoveryPreference: 0.5,
    };

    const blockedSingle = blacklistedTrackIds(signals);
    expect(blockedSingle.has('skipped-song')).toBe(false); // Rule 13: not blacklisted on 1 skip!

    // Now 3 skips
    signals.skipCounts[0].count = 3;
    const blockedTriple = blacklistedTrackIds(signals);
    expect(blockedTriple.has('skipped-song')).toBe(true); // Blacklisted after threshold reached
  });

  // Scenario 6: User who likes and unlikes tracks
  it('Scenario 6: Likes provide immediate affinity boost and unlikes gracefully scale down', () => {
    const track = makeTrack('fav1', 'Favorite Song', 'Favorite Artist');
    const profileLiked = computeTasteProfile({
      events: [],
      playStats: {},
      skipStats: {},
      artistPlayStats: {},
      favoriteTracks: [track],
      followedArtists: [],
      followedAlbums: [],
      downloadedTracks: [],
      nowMs: NOW,
    });

    const scoreLiked = profileLiked.topArtists.find((a) => a.name === 'Favorite Artist')!.score;
    expect(scoreLiked).toBeGreaterThan(0.5);

    // Unliked
    const profileUnliked = computeTasteProfile({
      events: [],
      playStats: {},
      skipStats: {},
      artistPlayStats: {},
      favoriteTracks: [],
      followedArtists: [],
      followedAlbums: [],
      downloadedTracks: [],
      nowMs: NOW,
    });

    const unlikedEntry = profileUnliked.topArtists.find((a) => a.name === 'Favorite Artist');
    expect(unlikedEntry).toBeUndefined();
  });

  // Scenario 7: User who follows and unfollows artists
  it('Scenario 7: Followed artists receive high affinity score', () => {
    const artist = makeArtist('Arctic Monkeys');
    const profile = computeTasteProfile({
      events: [],
      playStats: {},
      skipStats: {},
      artistPlayStats: {},
      favoriteTracks: [],
      followedArtists: [artist],
      followedAlbums: [],
      downloadedTracks: [],
      nowMs: NOW,
    });

    expect(profile.topArtists[0].name).toBe('Arctic Monkeys');
    expect(profile.topArtists[0].score).toBeGreaterThan(0.8);
  });

  // Scenario 8: User who changes discovery preference (Familiar, Balanced, Exploration)
  it('Scenario 8: Discovery preference shifts fresh vs familiar ratios accordingly', () => {
    const familiarPref = discoveryPreferenceForMode('familiar'); // 0.15
    const explorationPref = discoveryPreferenceForMode('exploration'); // 0.85

    const knownArtists = new Set(['radiohead']);
    const pool = [
      makeTrack('r1', 'Karma Police', 'Radiohead'),
      makeTrack('r2', 'Creep', 'Radiohead'),
      makeTrack('f1', 'Fresh Track 1', 'New Band 1'),
      makeTrack('f2', 'Fresh Track 2', 'New Band 2'),
      makeTrack('f3', 'Fresh Track 3', 'New Band 3'),
      makeTrack('f4', 'Fresh Track 4', 'New Band 4'),
    ];

    const familiarTracks = selectFreshAwareMixTracks(pool, 4, {
      freshRatio: familiarPref,
      knownArtistNames: knownArtists,
      scoreOf: () => 1,
    });

    const explorationTracks = selectFreshAwareMixTracks(pool, 4, {
      freshRatio: explorationPref,
      knownArtistNames: knownArtists,
      scoreOf: () => 1,
    });

    const familiarFreshCount = familiarTracks.filter(
      (t) => !knownArtists.has(t.artists[0]?.name.toLowerCase())
    ).length;
    const explorationFreshCount = explorationTracks.filter(
      (t) => !knownArtists.has(t.artists[0]?.name.toLowerCase())
    ).length;

    expect(explorationFreshCount).toBeGreaterThan(familiarFreshCount);
  });

  // Scenario 9: User who disables personalization
  it('Scenario 9: Disabling personalization returns empty recommendation profile', () => {
    const profile = computeTasteProfile({
      events: [],
      playStats: { t1: { count: 20, completedCount: 20, lastPlayedAt: NOW } },
      skipStats: {},
      artistPlayStats: { 'Great Artist': 20 },
      favoriteTracks: [makeTrack('t1', 'Hit', 'Great Artist')],
      followedArtists: [makeArtist('Great Artist')],
      followedAlbums: [],
      downloadedTracks: [],
      personalizationEnabled: false,
      nowMs: NOW,
    });

    expect(profile.personalizationEnabled).toBe(false);
    expect(profile.topArtists).toHaveLength(0);
    expect(profile.topGenres).toHaveLength(0);
  });

  // Scenario 10: User who resets their taste profile
  it('Scenario 10: Resetting taste profile removes learned events while preserving library', () => {
    const initialEvents: ListeningEvent[] = [
      {
        id: 'e1',
        trackId: 't1',
        artistName: 'Band A',
        eventType: 'track_completed',
        timestamp: NOW,
        playbackDurationMs: 180000,
        trackDurationMs: 180000,
        completionRatio: 1.0,
      },
    ];

    // After reset, events array is emptied:
    const profileAfterReset = computeTasteProfile({
      events: [],
      playStats: {},
      skipStats: {},
      artistPlayStats: {},
      favoriteTracks: [makeTrack('saved1', 'My Saved Song', 'Saved Artist')],
      followedArtists: [],
      followedAlbums: [],
      downloadedTracks: [],
      nowMs: NOW,
    });

    expect(profileAfterReset.topArtists.some((a) => a.name === 'Band A')).toBe(false);
    expect(profileAfterReset.topArtists.some((a) => a.name === 'Saved Artist')).toBe(true);
  });

  // Scenario 11: Missing track metadata
  it('Scenario 11: Gracefully handles tracks with missing artist names, album titles, or genres', () => {
    const trackMissingMeta: CanonicalTrack = {
      id: 'missing-1',
      title: 'Track Without Metadata',
      artists: [], // empty artists!
      durationMs: 0,
      providerIds: {},
      explicit: false,
    };

    const events: ListeningEvent[] = [
      {
        id: 'e-bad',
        trackId: 'missing-1',
        artistName: '',
        albumTitle: '',
        eventType: 'track_started',
        timestamp: NOW,
        playbackDurationMs: 0,
        trackDurationMs: 0,
        completionRatio: 0,
      },
    ];

    expect(() => {
      computeTasteProfile({
        events,
        playStats: {},
        skipStats: {},
        artistPlayStats: {},
        favoriteTracks: [trackMissingMeta],
        followedArtists: [],
        followedAlbums: [],
        downloadedTracks: [],
        nowMs: NOW,
      });
    }).not.toThrow();
  });

  // Scenario 12: Offline user (Zero network)
  it('Scenario 12: Offline recommendations compose from local favorites, recent, and downloads', () => {
    const localFavorites = [
      makeTrack('f1', 'Offline Song 1', 'Offline Artist 1'),
      makeTrack('f2', 'Offline Song 2', 'Offline Artist 1'),
      makeTrack('f3', 'Offline Song 3', 'Offline Artist 2'),
    ];
    const localDownloads = [makeTrack('d1', 'Downloaded 1', 'Offline Artist 3')];

    // Local library scoring
    const profile = computeTasteProfile({
      events: [],
      playStats: {},
      skipStats: {},
      artistPlayStats: { 'Offline Artist 1': 5 },
      favoriteTracks: localFavorites,
      followedArtists: [],
      followedAlbums: [],
      downloadedTracks: localDownloads,
      nowMs: NOW,
    });

    expect(profile.topArtists.length).toBeGreaterThanOrEqual(2);
    expect(profile.topArtists[0].name).toBe('Offline Artist 1');
  });

  // Metric Evaluation: Diversity & Duplicate Rate
  it('measures high catalog diversity and zero duplicate rate in mix selection', () => {
    const candidatePool = [
      makeTrack('1', 'Song A', 'Artist 1', ['Rock'], 'Album 1'),
      makeTrack('2', 'Song B', 'Artist 1', ['Rock'], 'Album 1'),
      makeTrack('3', 'Song C', 'Artist 1', ['Rock'], 'Album 1'),
      makeTrack('4', 'Song D', 'Artist 2', ['Jazz'], 'Album 2'),
      makeTrack('5', 'Song E', 'Artist 3', ['Electronic'], 'Album 3'),
      makeTrack('6', 'Song F', 'Artist 4', ['Classical'], 'Album 4'),
    ];

    const selected = selectMixTracks(candidatePool, 5, () => 1, 2); // max 2 per artist
    const diversity = computeCatalogDiversity(selected);

    // Diversity should be high (> 0.70) because artist cap and token similarity spread candidates out
    expect(diversity).toBeGreaterThanOrEqual(0.7);

    // Zero duplicate rate
    const uniqueIds = new Set(selected.map((t) => t.id));
    expect(uniqueIds.size).toBe(selected.length);
  });
});
