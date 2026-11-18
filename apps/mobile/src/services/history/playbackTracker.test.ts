import { beforeEach, describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { PlaybackTracker } from './playbackTracker';

function mockTrack(id: string, durationMs: number = 180_000): CanonicalTrack {
  return {
    id,
    title: 'Test Track',
    artists: [{ id: 'art-1', name: 'Test Artist', providerIds: {}, genres: ['Rock'] }],
    durationMs,
    providerIds: {},
    explicit: false,
  };
}

describe('PlaybackTracker', () => {
  let tracker: PlaybackTracker;

  beforeEach(() => {
    tracker = new PlaybackTracker();
  });

  it('starts session and emits track_started on initial progress', () => {
    const track = mockTrack('t1');
    const { session, isReplaySession } = tracker.startSession(track);

    expect(isReplaySession).toBe(false);
    expect(session.trackId).toBe('t1');
    expect(session.sessionId).toContain('sess_');

    const events = tracker.onProgress(0, 180_000, true, 1000);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('track_started');
    expect(events[0]!.positionMs).toBe(0);
  });

  it('accrues continuous playback and qualifies as meaningful play after 30s', () => {
    const track = mockTrack('t1', 180_000);
    tracker.startSession(track);
    tracker.onProgress(0, 180_000, true, 1000);

    // Progress at 10s
    let events = tracker.onProgress(10_000, 180_000, true, 11_000);
    expect(events).toHaveLength(0); // Not yet 30s, 0.25 checkpoint is at 45s

    // Progress at 30s (wall clock 31,000)
    events = tracker.onProgress(30_000, 180_000, true, 31_000);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('playback_progress');
    expect(events[0]!.meaningfulPlayQualified).toBe(true);
  });

  it('detects seeking forward and DOES NOT count seek gap as actual listening time', () => {
    const track = mockTrack('t1', 200_000);
    tracker.startSession(track);
    tracker.onProgress(0, 200_000, true, 1000);

    // User listens for 5s
    tracker.onProgress(5_000, 200_000, true, 6000);
    expect(tracker.getCurrentSession()!.accumulatedListenMs).toBe(5000);

    // User seeks forward from 5s to 150s in 500ms
    tracker.onSeek(150_000);
    tracker.onProgress(150_000, 200_000, true, 6500);

    // Accumulated listen time should NOT jump by 145 seconds!
    expect(tracker.getCurrentSession()!.accumulatedListenMs).toBe(5000);
  });

  it('rejects completion if user seeked to the end without actually listening', () => {
    const track = mockTrack('t1', 200_000);
    tracker.startSession(track);
    tracker.onProgress(0, 200_000, true, 1000);

    // User seeks to 198s
    tracker.onSeek(198_000);
    tracker.onProgress(198_000, 200_000, true, 2000);

    // Song completes
    const completionEvent = tracker.onCompletion(3000);
    expect(completionEvent).toBeNull(); // Rejected because accumulatedListenMs is only ~1s
  });

  it('qualifies completion when track was continuously played past 90%', () => {
    const track = mockTrack('t1', 50_000);
    tracker.startSession(track);
    tracker.onProgress(0, 50_000, true, 1000);

    // Play continuously to 46s (92%)
    tracker.onProgress(20_000, 50_000, true, 21_000);
    tracker.onProgress(46_000, 50_000, true, 47_000);

    const completion = tracker.onCompletion(48_000);
    expect(completion).not.toBeNull();
    expect(completion!.eventType).toBe('track_completed');
    expect(completion!.completionRatio).toBe(1.0);
  });

  it('pausing does not end session, and resume continues same session', () => {
    const track = mockTrack('t1', 180_000);
    const { session } = tracker.startSession(track);
    tracker.onProgress(0, 180_000, true, 1000);
    tracker.onProgress(10_000, 180_000, true, 11_000);

    // User pauses
    tracker.onPause();
    expect(tracker.getCurrentSession()!.sessionId).toBe(session.sessionId);

    // 1 minute later, user resumes
    tracker.onResume(71_000);
    expect(tracker.getCurrentSession()!.sessionId).toBe(session.sessionId);

    // Play continues for 10 more seconds
    tracker.onProgress(20_000, 180_000, true, 81_000);
    expect(tracker.getCurrentSession()!.accumulatedListenMs).toBe(20_000);
  });

  it('distinguishes early skips from late transitions', () => {
    // Early skip
    const track1 = mockTrack('t1', 180_000);
    tracker.startSession(track1);
    tracker.onProgress(0, 180_000, true, 1000);
    tracker.onProgress(8_000, 180_000, true, 9000);

    const skip1 = tracker.onSkip(9500);
    expect(skip1).not.toBeNull();
    expect(skip1!.eventType).toBe('track_skipped');
    expect(skip1!.meaningfulPlayQualified).toBe(false);

    // Late skip (after qualifying)
    const track2 = mockTrack('t2', 180_000);
    tracker.startSession(track2);
    tracker.onProgress(0, 180_000, true, 10_000);
    tracker.onProgress(40_000, 180_000, true, 50_000);

    const skip2 = tracker.onSkip(51_000);
    expect(skip2).not.toBeNull();
    expect(skip2!.eventType).toBe('track_skipped');
    expect(skip2!.meaningfulPlayQualified).toBe(true);
  });

  it('detects a replay when restarting the same track within 5 minutes', () => {
    const track = mockTrack('t1', 40_000);
    tracker.startSession(track);
    tracker.onProgress(0, 40_000, true, 1000);
    tracker.onProgress(38_000, 40_000, true, 39_000);
    tracker.onCompletion(40_000);

    // Replay 30 seconds later
    const replay = tracker.startSession(track, 'stream', 70_000);
    expect(replay.isReplaySession).toBe(true);
  });
});
