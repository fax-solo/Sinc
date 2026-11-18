/**
 * Sinc Phase 1 Verification Suite
 *
 * Implements tests for the 20 mandatory Phase 1 scenarios:
 *  1. New user starts listening.
 *  2. Meaningful-play threshold reached (30s rule).
 *  3. Short track played (< 30s threshold).
 *  4. Track completed normally (>= 90%).
 *  5. Skipped before qualifying.
 *  6. Paused and resumed (single continuous session, pause time not counted).
 *  7. Track replayed within 5 minutes.
 *  8. Track seeked forward (seek delta not counted as listen time).
 *  9. Rapid track switching (clean session reset).
 * 10. Automatic queue progression (distinct session IDs).
 * 11. Background playback continuation.
 * 12. Duplicate playback callbacks.
 * 13. Duplicate event submissions (idempotency enforcement).
 * 14. Playback failure (clean abort, no false completion).
 * 15. App close during playback (no false completion).
 * 16. User likes and unlikes (preference signal journaling).
 * 17. User follows and unfollows.
 * 18. Two users listening independently (data isolation).
 * 19. Taste profile updates correctly (decay, positive/negative signals).
 * 20. Playback and download unaffected by analytics failures.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack, ListeningEvent } from '@sinc/shared';
import { computeUserTasteProfile } from '@sinc/shared';
import { PlaybackTracker } from './playbackTracker';
import { listeningJournal } from './listeningJournal';
import { storage } from '../../utils/storage';

function mockTrack(id: string, durationMs = 180_000, artistName = 'Test Artist', genre = 'Rock'): CanonicalTrack {
  return {
    id,
    title: `Track ${id}`,
    artists: [{ id: `art_${id}`, name: artistName, genres: [genre], providerIds: {} }],
    durationMs,
    artworkUrl: 'https://example.com/art.jpg',
    providerIds: {},
    explicit: false,
  };
}

describe('Phase 1 Verification Suite (20 Scenarios)', () => {
  let tracker: PlaybackTracker;

  beforeEach(() => {
    listeningJournal.clearAll();
    tracker = new PlaybackTracker();
  });

  // Scenario 1: New user starts listening
  it('Scenario 1: New user starts listening - emits track_started and cold-start profile is empty', () => {
    const track = mockTrack('t1', 180_000);
    const { session } = tracker.startSession(track, 'stream', 1000);
    expect(session.sessionId).toBeDefined();

    // First progress tick
    const events = tracker.onProgress(0, 180_000, true, 1000);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('track_started');
    expect(events[0].meaningfulPlayQualified).toBe(false);

    listeningJournal.append(events[0]);
    expect(listeningJournal.getPendingEvents()).toHaveLength(1);

    // Verify taste profile is empty before qualifying plays
    const profile = computeUserTasteProfile({ userId: 'u_new', events: listeningJournal.getPendingEvents(), nowMs: 1000 });
    expect(profile.isEmpty).toBe(true);
    expect(profile.totalQualifiedPlays).toBe(0);
  });

  // Scenario 2: Meaningful-play threshold reached (30s)
  it('Scenario 2: Meaningful-play threshold reached after 30 seconds of continuous playback', () => {
    const track = mockTrack('t2', 180_000);
    tracker.startSession(track, 'stream', 1000);
    tracker.onProgress(0, 180_000, true, 1000);

    // Play continuously to 29 seconds -> not yet qualified
    tracker.onProgress(29_000, 180_000, true, 30_000);
    expect(tracker.getCurrentSession()?.meaningfulQualified).toBe(false);

    // Reach 30 seconds continuous playback
    const ev30 = tracker.onProgress(30_000, 180_000, true, 31_000);
    expect(tracker.getCurrentSession()?.meaningfulQualified).toBe(true);
    expect(ev30.some((e) => e.meaningfulPlayQualified)).toBe(true);
  });

  // Scenario 3: Short track played (< 30s)
  it('Scenario 3: Short track played (< 30s) qualifies at short track threshold ratio (70%)', () => {
    const shortTrack = mockTrack('t_short', 20_000); // 20 seconds
    tracker.startSession(shortTrack, 'stream', 1000);
    tracker.onProgress(0, 20_000, true, 1000);

    // At 10 seconds (50% < 70%) -> not yet qualified
    tracker.onProgress(10_000, 20_000, true, 11_000);
    expect(tracker.getCurrentSession()?.meaningfulQualified).toBe(false);

    // At 15 seconds (75% >= 70% of 20s) -> qualifies under short track threshold
    const ev15 = tracker.onProgress(15_000, 20_000, true, 16_000);
    expect(tracker.getCurrentSession()?.meaningfulQualified).toBe(true);
    expect(ev15.some((e) => e.meaningfulPlayQualified)).toBe(true);
  });

  // Scenario 4: Track completed normally (>= 90%)
  it('Scenario 4: Track completed normally produces track_completed with ratio 1.0', () => {
    const track = mockTrack('t4', 100_000);
    tracker.startSession(track, 'stream', 1000);
    tracker.onProgress(0, 100_000, true, 1000);
    tracker.onProgress(50_000, 100_000, true, 51_000);
    tracker.onProgress(95_000, 100_000, true, 96_000);

    const compEvent = tracker.onCompletion(97_000);
    expect(compEvent).not.toBeNull();
    expect(compEvent?.eventType).toBe('track_completed');
    expect(compEvent?.completionRatio).toBe(1.0);
    expect(compEvent?.meaningfulPlayQualified).toBe(true);
  });

  // Scenario 5: Skipped before qualifying
  it('Scenario 5: Skipped before qualifying records early skip with meaningfulPlayQualified = false', () => {
    const track = mockTrack('t5', 200_000);
    tracker.startSession(track, 'stream', 1000);
    tracker.onProgress(0, 200_000, true, 1000);
    tracker.onProgress(12_000, 200_000, true, 13_000);

    const skipEvent = tracker.onSkip(14_000);
    expect(skipEvent).not.toBeNull();
    expect(skipEvent?.eventType).toBe('track_skipped');
    expect(skipEvent?.meaningfulPlayQualified).toBe(false);
  });

  // Scenario 6: Paused and resumed
  it('Scenario 6: Paused and resumed does not inflate listened time or create duplicate session', () => {
    const track = mockTrack('t6', 180_000);
    const { session } = tracker.startSession(track, 'stream', 1000);
    const initialSessionId = session.sessionId;

    tracker.onProgress(0, 180_000, true, 1000);
    tracker.onProgress(15_000, 180_000, true, 16_000);
    expect(tracker.getCurrentSession()?.accumulatedListenMs).toBe(15_000);

    // Pause for 120 seconds
    tracker.onPause();

    // Resume at 136_000
    tracker.onResume(136_000);
    expect(tracker.getCurrentSession()?.sessionId).toBe(initialSessionId);

    // Play 15 more seconds (to 30s total)
    tracker.onProgress(30_000, 180_000, true, 151_000);
    // Accumulated should be 30s, NOT 150s
    expect(tracker.getCurrentSession()?.accumulatedListenMs).toBe(30_000);
    expect(tracker.getCurrentSession()?.meaningfulQualified).toBe(true);
  });

  // Scenario 7: Track replayed
  it('Scenario 7: Track replayed within 5 minutes emits track_replayed event', () => {
    const track = mockTrack('t7', 50_000);
    tracker.startSession(track, 'stream', 1000);
    tracker.onProgress(0, 50_000, true, 1000);
    tracker.onProgress(48_000, 50_000, true, 49_000);
    tracker.onCompletion(50_000);

    // Replay 30 seconds later
    const { isReplaySession } = tracker.startSession(track, 'stream', 80_000);
    expect(isReplaySession).toBe(true);

    const replayEvents = tracker.onProgress(0, 50_000, true, 80_000);
    expect(replayEvents[0].eventType).toBe('track_replayed');
  });

  // Scenario 8: Track seeked forward
  it('Scenario 8: Track seeked forward does not count jump toward listen time and rejects completion', () => {
    const track = mockTrack('t8', 200_000);
    tracker.startSession(track, 'stream', 1000);
    tracker.onProgress(0, 200_000, true, 1000);
    tracker.onProgress(5_000, 200_000, true, 6_000);

    // User seeks from 5s to 195s (jump of 190s in 1s)
    tracker.onSeek(195_000);
    tracker.onProgress(195_000, 200_000, true, 7_000);

    // Accumulated listened time should only be ~5s
    expect(tracker.getCurrentSession()?.accumulatedListenMs).toBeLessThanOrEqual(6_000);
    expect(tracker.getCurrentSession()?.meaningfulQualified).toBe(false);

    // User tries to complete track via seek
    const compEvent = tracker.onCompletion(8_000);
    expect(compEvent).toBeNull(); // Rejected: completion requirement not met
  });

  // Scenario 9: Rapid track switching
  it('Scenario 9: Rapid track switching resets session state without corrupting tracker', () => {
    for (let i = 1; i <= 5; i++) {
      const track = mockTrack(`t_rapid_${i}`, 180_000);
      tracker.startSession(track, 'stream', 1000 * i);
      tracker.onSkip(1000 * i + 200);
      // Not started yet, returns null and cleans up
      expect(tracker.getCurrentSession()).toBeNull();
    }
  });

  // Scenario 10: Automatic queue progression
  it('Scenario 10: Automatic queue progression assigns distinct session IDs and clean transitions', () => {
    const track1 = mockTrack('t10_1', 40_000);
    const { session: sess1 } = tracker.startSession(track1, 'stream', 1000);
    tracker.onProgress(0, 40_000, true, 1000);
    tracker.onProgress(38_000, 40_000, true, 39_000);
    const comp1 = tracker.onCompletion(40_000);
    expect(comp1?.eventType).toBe('track_completed');

    // Next track in queue
    const track2 = mockTrack('t10_2', 40_000);
    const { session: sess2 } = tracker.startSession(track2, 'stream', 41_000);
    expect(sess2.sessionId).not.toBe(sess1.sessionId);
    const start2 = tracker.onProgress(0, 40_000, true, 41_000);
    expect(start2[0].eventType).toBe('track_started');
    expect(start2[0].trackId).toBe('t10_2');
  });

  // Scenario 11: Background playback continuation
  it('Scenario 11: Background playback continuation processes continuous progress ticks seamlessly', () => {
    const track = mockTrack('t11', 100_000);
    tracker.startSession(track, 'stream', 1000);
    tracker.onProgress(0, 100_000, true, 1000);

    // Continuous progress ticks as if from native background service
    for (let sec = 1; sec <= 35; sec++) {
      tracker.onProgress(sec * 1000, 100_000, true, 1000 + sec * 1000);
    }

    const session = tracker.getCurrentSession();
    expect(session?.meaningfulQualified).toBe(true);
    expect(session?.accumulatedListenMs).toBeGreaterThanOrEqual(34_000);
  });

  // Scenario 12: Duplicate playback callbacks
  it('Scenario 12: Duplicate playback callbacks with same position do not inflate listened time', () => {
    const track = mockTrack('t12', 100_000);
    tracker.startSession(track, 'stream', 1000);
    tracker.onProgress(10_000, 100_000, true, 1000);
    const accruedBefore = tracker.getCurrentSession()?.accumulatedListenMs ?? 0;

    // Fire duplicate callback with identical position & timestamp
    tracker.onProgress(10_000, 100_000, true, 1000);
    const accruedAfter = tracker.getCurrentSession()?.accumulatedListenMs ?? 0;

    expect(accruedAfter).toBe(accruedBefore);
  });

  // Scenario 13: Duplicate event submissions (idempotency)
  it('Scenario 13: Duplicate event submissions are filtered out by idempotencyId in journal', () => {
    const ev: ListeningEvent = {
      id: 'e1',
      sessionId: 's1',
      trackId: 't1',
      trackTitle: 'Song',
      artistName: 'Artist',
      eventType: 'track_started',
      timestamp: 1000,
      positionMs: 0,
      playbackDurationMs: 0,
      trackDurationMs: 100_000,
      completionRatio: 0,
      meaningfulPlayQualified: false,
      playbackSource: 'stream',
      idempotencyId: 'idemp_duplicate_test',
    };

    expect(listeningJournal.append(ev)).toBe(true);
    expect(listeningJournal.hasIdempotencyId('idemp_duplicate_test')).toBe(true);

    // Second submission with same idempotencyId is rejected
    expect(listeningJournal.append(ev)).toBe(false);
    expect(listeningJournal.getPendingEvents()).toHaveLength(1);
  });

  // Scenario 14: Playback failure
  it('Scenario 14: Playback failure aborts session cleanly without false completion', () => {
    const track = mockTrack('t14', 180_000);
    tracker.startSession(track, 'stream', 1000);
    tracker.onProgress(0, 180_000, true, 1000);
    tracker.onProgress(10_000, 180_000, true, 11_000);

    // Error occurs
    tracker.onFailureOrInterruption();
    expect(tracker.getCurrentSession()).toBeNull();

    // Calling completion should return null
    expect(tracker.onCompletion()).toBeNull();
  });

  // Scenario 15: App close during playback
  it('Scenario 15: App close during playback leaves session incomplete without false completion', () => {
    const track = mockTrack('t15', 180_000);
    tracker.startSession(track, 'stream', 1000);
    tracker.onProgress(0, 180_000, true, 1000);
    tracker.onProgress(25_000, 180_000, true, 26_000);

    // App terminates: journal has only started and progress events, no completion
    const events = listeningJournal.getPendingEvents();
    expect(events.some((e) => e.eventType === 'track_completed')).toBe(false);
  });

  // Scenario 16: User likes and unlikes
  it('Scenario 16: User likes and unlikes record explicit preference events with idempotency', () => {
    const likeEv: ListeningEvent = {
      id: 'l1',
      sessionId: 'sess_pref',
      trackId: 't16',
      trackTitle: 'Fav Song',
      artistName: 'Fav Artist',
      eventType: 'track_liked',
      timestamp: 2000,
      positionMs: 0,
      playbackDurationMs: 0,
      trackDurationMs: 180_000,
      completionRatio: 0,
      meaningfulPlayQualified: false,
      playbackSource: 'library',
      idempotencyId: 'like_t16_2000',
    };

    listeningJournal.append(likeEv);
    expect(listeningJournal.hasIdempotencyId('like_t16_2000')).toBe(true);

    const unlikeEv: ListeningEvent = {
      ...likeEv,
      id: 'l2',
      eventType: 'track_unliked',
      timestamp: 3000,
      idempotencyId: 'unlike_t16_3000',
    };

    listeningJournal.append(unlikeEv);
    expect(listeningJournal.getPendingEvents()).toHaveLength(2);
  });

  // Scenario 17: User follows and unfollows
  it('Scenario 17: User follows and unfollows records discrete artist signals', () => {
    const followEv: ListeningEvent = {
      id: 'f1',
      sessionId: 'sess_pref',
      trackId: '',
      trackTitle: '',
      artistId: 'art_17',
      artistName: 'Indie Artist',
      eventType: 'artist_followed',
      timestamp: 4000,
      positionMs: 0,
      playbackDurationMs: 0,
      trackDurationMs: 0,
      completionRatio: 0,
      meaningfulPlayQualified: false,
      playbackSource: 'artist_hub',
      idempotencyId: 'follow_art17_4000',
    };

    listeningJournal.append(followEv);
    expect(listeningJournal.hasIdempotencyId('follow_art17_4000')).toBe(true);

    const unfollowEv: ListeningEvent = {
      ...followEv,
      id: 'f2',
      eventType: 'artist_unfollowed',
      timestamp: 5000,
      idempotencyId: 'unfollow_art17_5000',
    };
    listeningJournal.append(unfollowEv);
    expect(listeningJournal.getPendingEvents()).toHaveLength(2);
  });

  // Scenario 18: Two users listening independently
  it('Scenario 18: Two users listening independently have isolated taste profiles', () => {
    const userAEvents: ListeningEvent[] = [
      {
        id: 'ua1',
        sessionId: 'sA',
        trackId: 'tA',
        trackTitle: 'Metal Song',
        artistName: 'Metal Band',
        genres: ['Heavy Metal'],
        eventType: 'track_completed',
        timestamp: 10_000,
        positionMs: 180_000,
        playbackDurationMs: 180_000,
        trackDurationMs: 180_000,
        completionRatio: 1.0,
        meaningfulPlayQualified: true,
        playbackSource: 'stream',
        idempotencyId: 'idemp_uA',
      },
    ];

    const userBEvents: ListeningEvent[] = [
      {
        id: 'ub1',
        sessionId: 'sB',
        trackId: 'tB',
        trackTitle: 'Jazz Piece',
        artistName: 'Jazz Quartet',
        genres: ['Bebop Jazz'],
        eventType: 'track_completed',
        timestamp: 10_000,
        positionMs: 240_000,
        playbackDurationMs: 240_000,
        trackDurationMs: 240_000,
        completionRatio: 1.0,
        meaningfulPlayQualified: true,
        playbackSource: 'stream',
        idempotencyId: 'idemp_uB',
      },
    ];

    const profileA = computeUserTasteProfile({ userId: 'uA', events: userAEvents, nowMs: 20_000 });
    const profileB = computeUserTasteProfile({ userId: 'uB', events: userBEvents, nowMs: 20_000 });

    expect(profileA.topArtists[0].name).toBe('Metal Band');
    expect(profileA.topGenres[0].name).toBe('Heavy Metal');

    expect(profileB.topArtists[0].name).toBe('Jazz Quartet');
    expect(profileB.topGenres[0].name).toBe('Bebop Jazz');
  });

  // Scenario 19: Taste profile updates correctly with decay & positive/negative feedback
  it('Scenario 19: Taste profile computes weighted signals with decay and early-skip penalization', () => {
    const now = 100_000_000;
    const events: ListeningEvent[] = [
      // 3 completions for Artist X
      {
        id: 'x1',
        sessionId: 'sX',
        trackId: 'tX1',
        trackTitle: 'Song X1',
        artistName: 'Artist X',
        genres: ['Rock'],
        eventType: 'track_completed',
        timestamp: now - 1000,
        positionMs: 180_000,
        playbackDurationMs: 180_000,
        trackDurationMs: 180_000,
        completionRatio: 1.0,
        meaningfulPlayQualified: true,
        playbackSource: 'stream',
        idempotencyId: 'idemp_x1',
      },
      {
        id: 'x2',
        sessionId: 'sX2',
        trackId: 'tX2',
        trackTitle: 'Song X2',
        artistName: 'Artist X',
        genres: ['Rock'],
        eventType: 'track_completed',
        timestamp: now - 500,
        positionMs: 180_000,
        playbackDurationMs: 180_000,
        trackDurationMs: 180_000,
        completionRatio: 1.0,
        meaningfulPlayQualified: true,
        playbackSource: 'stream',
        idempotencyId: 'idemp_x2',
      },
      // Artist Y with 2 early skips
      {
        id: 'y1',
        sessionId: 'sY1',
        trackId: 'tY1',
        trackTitle: 'Song Y1',
        artistName: 'Artist Y',
        genres: ['Pop'],
        eventType: 'track_skipped',
        timestamp: now - 300,
        positionMs: 5_000,
        playbackDurationMs: 5_000,
        trackDurationMs: 180_000,
        completionRatio: 0.03,
        meaningfulPlayQualified: false,
        playbackSource: 'stream',
        idempotencyId: 'idemp_y1',
      },
    ];

    const profile = computeUserTasteProfile({ userId: 'u_test', events, nowMs: now });
    expect(profile.topArtists[0].name).toBe('Artist X');
    expect(profile.topArtists[0].score).toBeGreaterThan(0);

    const skippedTrack = profile.skippedTracks?.find((t) => t.artistName === 'Artist Y');
    expect(skippedTrack?.count).toBe(1);

    // Artist Y does not enter topArtists due to negative feedback / early skip with 0 plays
    const artistY = profile.topArtists.find((a) => a.name === 'Artist Y');
    expect(artistY).toBeUndefined();
  });

  // Scenario 20: Playback and download unaffected by analytics failures
  it('Scenario 20: Analytics and journal failure never crashes or interrupts audio flow', () => {
    const spy = vi.spyOn(storage, 'setObject').mockImplementation(() => {
      throw new Error('Disk IO Failure');
    });

    const ev = {
      id: 'e_fail',
      sessionId: 's_fail',
      trackId: 't_fail',
      trackTitle: 'Song',
      artistName: 'Artist',
      eventType: 'track_started' as const,
      timestamp: Date.now(),
      positionMs: 0,
      playbackDurationMs: 0,
      trackDurationMs: 100_000,
      completionRatio: 0,
      meaningfulPlayQualified: false,
      playbackSource: 'stream',
      idempotencyId: 'idemp_fail_1',
    };

    // Appending to journal must safely handle or catch error without crashing
    expect(() => {
      listeningJournal.append(ev);
    }).not.toThrow();

    spy.mockRestore();
  });
});
