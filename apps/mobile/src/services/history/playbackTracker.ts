/**
 * Sinc Playback Session Tracker
 *
 * State machine managing playback session lifecycle and telemetry:
 * - Distinguishes actual continuous listening from seeking.
 * - Enforces meaningful play qualification (the 30-second rule).
 * - Distinguishes early skips from late transitions.
 * - Prevents seeking to the end from falsely claiming completion.
 * - Prevents pause/resume from restarting sessions.
 * - Generates discrete, idempotent ListeningEvent objects.
 */

import type { CanonicalTrack, ListeningEvent } from '@sinc/shared';
import {
  DEFAULT_QUALIFICATION_CONFIG,
  type PlayQualificationConfig,
  getReachedCheckpoints,
  isEarlySkip,
  isReplay,
  qualifiesAsCompletion,
  qualifiesAsMeaningfulPlay,
} from '@sinc/shared';

export interface PlaybackSessionState {
  sessionId: string;
  trackId: string;
  trackTitle: string;
  artistId?: string;
  artistName: string;
  albumId?: string;
  albumTitle?: string;
  genres: string[];
  trackDurationMs: number;
  playbackSource: string;
  hasStarted: boolean;
  isReplay?: boolean;
  meaningfulQualified: boolean;
  completed: boolean;
  accumulatedListenMs: number;
  lastPositionMs: number;
  lastTickTimeMs: number;
  reachedCheckpoints: Set<number>;
  startTimeMs: number;
}

export class PlaybackTracker {
  private currentSession: PlaybackSessionState | null = null;
  private lastTrackId: string | null = null;
  private lastTrackTimeMs = 0;
  private lastCompletedTrackId: string | null = null;
  private lastCompletedTimeMs = 0;

  constructor(private readonly config: PlayQualificationConfig = DEFAULT_QUALIFICATION_CONFIG) {}

  /**
   * Starts a new listening session for a track.
   */
  startSession(
    track: CanonicalTrack,
    playbackSource: 'stream' | 'download' | 'local' | string = 'stream',
    nowMs: number = Date.now()
  ): { session: PlaybackSessionState; isReplaySession: boolean } {
    const lastId = this.lastCompletedTrackId ?? this.lastTrackId;
    const lastTime = this.lastCompletedTrackId ? this.lastCompletedTimeMs : this.lastTrackTimeMs;
    const isReplaySession = isReplay(
      lastId,
      track.id,
      lastTime,
      nowMs,
      this.config
    );

    this.lastTrackId = track.id;
    this.lastTrackTimeMs = nowMs;

    const sessionId = `sess_${nowMs}_${Math.random().toString(36).slice(2, 9)}`;
    const session: PlaybackSessionState = {
      sessionId,
      trackId: track.id,
      trackTitle: track.title,
      artistId: track.artists[0]?.id,
      artistName: track.artists[0]?.name ?? 'Unknown Artist',
      albumId: track.album?.id,
      albumTitle: track.album?.title,
      genres: track.artists[0]?.genres ?? [],
      trackDurationMs: track.durationMs || 0,
      playbackSource,
      hasStarted: false,
      isReplay: isReplaySession,
      meaningfulQualified: false,
      completed: false,
      accumulatedListenMs: 0,
      lastPositionMs: 0,
      lastTickTimeMs: 0,
      reachedCheckpoints: new Set<number>(),
      startTimeMs: nowMs,
    };

    this.currentSession = session;
    return { session, isReplaySession };
  }

  /**
   * Returns the current session state, if active.
   */
  getCurrentSession(): PlaybackSessionState | null {
    return this.currentSession;
  }

  /**
   * Processes a progress tick from the native player.
   * Accrues actual listened time and evaluates checkpoints and qualification.
   */
  onProgress(
    positionMs: number,
    durationMs: number,
    isPlaying: boolean,
    nowMs: number = Date.now()
  ): ListeningEvent[] {
    const session = this.currentSession;
    if (!session || !isPlaying) {
      if (session) {
        session.lastTickTimeMs = 0;
      }
      return [];
    }

    if (durationMs > 0 && session.trackDurationMs <= 0) {
      session.trackDurationMs = durationMs;
    }

    const events: ListeningEvent[] = [];

    // 1. Detect first playback start
    if (!session.hasStarted && positionMs >= 0) {
      session.hasStarted = true;
      session.lastPositionMs = positionMs;
      session.lastTickTimeMs = nowMs;

      events.push(
        this.buildEvent({
          session,
          eventType: session.isReplay ? 'track_replayed' : 'track_started',
          timestamp: nowMs,
          positionMs,
          meaningfulPlayQualified: false,
        })
      );
    }

    // 2. Continuous playback time tracking (rejecting seeks)
    if (session.lastTickTimeMs > 0) {
      const elapsedWallClock = Math.max(0, nowMs - session.lastTickTimeMs);
      const positionDelta = positionMs - session.lastPositionMs;

      // Seeking detection:
      // If position leaped forward by > 3s more than wall-clock elapsed, or jumped backward,
      // it is a seek and does NOT count as continuous listening time.
      const isSeekForward = positionDelta > elapsedWallClock + 3_000;
      const isSeekBackward = positionDelta < -1_000;

      if (!isSeekForward && !isSeekBackward && elapsedWallClock > 0 && positionDelta >= 0) {
        // Normal continuous playback: accrue bounded elapsed time
        const accrued = Math.min(elapsedWallClock, positionDelta + 500);
        session.accumulatedListenMs += accrued;
      }
    }

    session.lastPositionMs = positionMs;
    session.lastTickTimeMs = nowMs;

    const trackDuration = session.trackDurationMs || durationMs;

    // 3. Meaningful play qualification check (the 30s rule or short track rule)
    if (
      !session.meaningfulQualified &&
      qualifiesAsMeaningfulPlay(session.accumulatedListenMs, trackDuration, this.config)
    ) {
      session.meaningfulQualified = true;
      events.push(
        this.buildEvent({
          session,
          eventType: 'playback_progress',
          timestamp: nowMs,
          positionMs,
          meaningfulPlayQualified: true,
        })
      );
    }

    // 4. Progress checkpoints (25%, 50%, 75%)
    const newCheckpoints = getReachedCheckpoints(
      positionMs,
      trackDuration,
      session.reachedCheckpoints,
      this.config
    );

    for (const checkpoint of newCheckpoints) {
      session.reachedCheckpoints.add(checkpoint);
      events.push(
        this.buildEvent({
          session,
          eventType: 'playback_progress',
          timestamp: nowMs,
          positionMs,
          meaningfulPlayQualified: session.meaningfulQualified,
        })
      );
    }

    return events;
  }

  /**
   * Explicitly notes that a seek occurred so continuous timer resets.
   */
  onSeek(targetPositionMs: number): void {
    const session = this.currentSession;
    if (!session) return;
    session.lastPositionMs = targetPositionMs;
    session.lastTickTimeMs = 0; // Forces next progress tick to establish fresh continuous baseline
  }

  /**
   * User paused playback. Pausing is NOT skipping.
   */
  onPause(): void {
    const session = this.currentSession;
    if (!session) return;
    session.lastTickTimeMs = 0;
  }

  /**
   * User resumed playback. Continues current session.
   */
  onResume(nowMs: number = Date.now()): void {
    const session = this.currentSession;
    if (!session) return;
    session.lastTickTimeMs = nowMs;
  }

  /**
   * User skipped the track (manual Next/Previous/Queue Jump).
   */
  onSkip(nowMs: number = Date.now()): ListeningEvent | null {
    const session = this.currentSession;
    if (!session || !session.hasStarted || session.completed) {
      this.currentSession = null;
      return null;
    }

    const early = isEarlySkip(
      session.accumulatedListenMs,
      session.lastPositionMs,
      session.trackDurationMs,
      this.config
    );

    const event = this.buildEvent({
      session,
      eventType: 'track_skipped',
      timestamp: nowMs,
      positionMs: session.lastPositionMs,
      meaningfulPlayQualified: session.meaningfulQualified,
    });

    this.currentSession = null;
    return event;
  }

  /**
   * Track finished playing naturally to completion.
   */
  onCompletion(nowMs: number = Date.now()): ListeningEvent | null {
    const session = this.currentSession;
    if (!session || !session.hasStarted || session.completed) {
      this.currentSession = null;
      return null;
    }

    const qualified = qualifiesAsCompletion(
      session.accumulatedListenMs,
      session.lastPositionMs,
      session.trackDurationMs,
      this.config
    );

    if (!qualified) {
      // Reached the end (e.g. through a seek) without having listened to required ratio
      this.currentSession = null;
      return null;
    }

    session.completed = true;
    this.lastCompletedTrackId = session.trackId;
    this.lastCompletedTimeMs = nowMs;

    const event = this.buildEvent({
      session,
      eventType: 'track_completed',
      timestamp: nowMs,
      positionMs: session.trackDurationMs,
      meaningfulPlayQualified: true,
      completionRatio: 1.0,
    });

    this.currentSession = null;
    return event;
  }

  /**
   * Playback interrupted or errored out.
   */
  onFailureOrInterruption(): void {
    this.currentSession = null;
  }

  private buildEvent(params: {
    session: PlaybackSessionState;
    eventType: ListeningEvent['eventType'];
    timestamp: number;
    positionMs: number;
    meaningfulPlayQualified: boolean;
    completionRatio?: number;
  }): ListeningEvent {
    const { session, eventType, timestamp, positionMs, meaningfulPlayQualified } = params;
    const trackDuration = session.trackDurationMs;
    const ratio =
      params.completionRatio !== undefined
        ? params.completionRatio
        : trackDuration > 0
          ? Math.min(1.0, Math.round((positionMs / trackDuration) * 100) / 100)
          : 0;

    const idempotencyId = `${session.sessionId}_${eventType}_${positionMs}_${timestamp}`;

    return {
      id: `ev_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId: session.sessionId,
      trackId: session.trackId,
      trackTitle: session.trackTitle,
      artistId: session.artistId,
      artistName: session.artistName,
      albumId: session.albumId,
      albumTitle: session.albumTitle,
      genres: session.genres,
      eventType,
      timestamp,
      positionMs,
      playbackDurationMs: session.accumulatedListenMs,
      trackDurationMs: trackDuration,
      completionRatio: ratio,
      meaningfulPlayQualified,
      playbackSource: session.playbackSource,
      idempotencyId,
    };
  }
}

export const playbackTracker = new PlaybackTracker();
