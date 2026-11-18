/**
 * Sinc Central Play Qualification Policy & Configuration
 *
 * Defines deterministic, configurable criteria for distinguishing:
 * - A qualified meaningful play (at least 30 seconds of actual playback, or short-track threshold).
 * - A completed listen (at least 90% listened or continuous play to end).
 * - An early skip (manual transition before qualifying) vs late transition.
 * - Replays (repeat play within replay window).
 * - Progress checkpoints (avoiding noisy per-tick events).
 */

export interface PlayQualificationConfig {
  /** Minimum actual continuous playback required for a track to count as a qualified play (ms). Default: 30,000 (30s) */
  meaningfulPlayThresholdMs: number;
  /** Maximum duration of a track considered a "short track" (ms). Default: 30,000 (30s) */
  shortTrackMaxDurationMs: number;
  /** For tracks shorter than shortTrackMaxDurationMs, the percentage of the track required to qualify (0..1). Default: 0.70 (70%) */
  shortTrackThresholdRatio: number;
  /** Minimum ratio of track duration required to qualify as full completion (0..1). Default: 0.90 (90%) */
  completionThresholdRatio: number;
  /** Max ms before the end of the track to count as completion even if slightly under ratio. Default: 5,000 (5s) */
  completionGracePeriodMs: number;
  /** Cutoff for an early skip (ms). Skips before this are early skips; after are late transitions. Default: 30,000 (30s) */
  earlySkipThresholdMs: number;
  /** Ratio cutoff for early skips when duration is known (0..1). Default: 0.25 (25%) */
  earlySkipRatioThreshold: number;
  /** Window within which a repeat play of the same track counts as a replay (ms). Default: 300,000 (5m) */
  replayWindowMs: number;
  /** Progress checkpoint percentages to emit progress events at (e.g. 0.25, 0.50, 0.75). */
  progressCheckpoints: readonly number[];
}

export const DEFAULT_QUALIFICATION_CONFIG: PlayQualificationConfig = {
  meaningfulPlayThresholdMs: 30_000,
  shortTrackMaxDurationMs: 30_000,
  shortTrackThresholdRatio: 0.70,
  completionThresholdRatio: 0.90,
  completionGracePeriodMs: 5_000,
  earlySkipThresholdMs: 30_000,
  earlySkipRatioThreshold: 0.25,
  replayWindowMs: 300_000,
  progressCheckpoints: [0.25, 0.50, 0.75],
};

/**
 * Returns true if the track is considered a short track (< 30 seconds).
 */
export function isShortTrack(
  trackDurationMs: number,
  config: PlayQualificationConfig = DEFAULT_QUALIFICATION_CONFIG
): boolean {
  return trackDurationMs > 0 && trackDurationMs < config.shortTrackMaxDurationMs;
}

/**
 * Checks whether the actual continuous playback duration qualifies as a meaningful play.
 * - Standard tracks (>= 30s): requires at least 30s of actual continuous listening.
 * - Short tracks (< 30s): requires at least shortTrackThresholdRatio (70%) of actual continuous listening.
 */
export function qualifiesAsMeaningfulPlay(
  actualListenMs: number,
  trackDurationMs: number,
  config: PlayQualificationConfig = DEFAULT_QUALIFICATION_CONFIG
): boolean {
  if (actualListenMs <= 0) return false;

  if (isShortTrack(trackDurationMs, config)) {
    const requiredMs = trackDurationMs * config.shortTrackThresholdRatio;
    return actualListenMs >= requiredMs;
  }

  // If duration is unknown (0), fall back to standard 30s threshold
  return actualListenMs >= config.meaningfulPlayThresholdMs;
}

/**
 * Checks whether the playback session qualifies as a completed listen.
 * - Requires at least completionThresholdRatio (90%) of actual continuous playback,
 *   OR playback reaching within completionGracePeriodMs (5s) of the end through actual listening.
 * - Seeking to the end without actually listening will NOT qualify as completion.
 */
export function qualifiesAsCompletion(
  actualListenMs: number,
  positionMs: number,
  trackDurationMs: number,
  config: PlayQualificationConfig = DEFAULT_QUALIFICATION_CONFIG
): boolean {
  if (actualListenMs <= 0) return false;

  // Short tracks (< 30s)
  if (isShortTrack(trackDurationMs, config)) {
    return actualListenMs >= trackDurationMs * config.completionThresholdRatio;
  }

  if (trackDurationMs > 0) {
    const reachedEndByListening =
      positionMs >= trackDurationMs - config.completionGracePeriodMs &&
      actualListenMs >= trackDurationMs * 0.75;
    const listenedFullRatio = actualListenMs >= trackDurationMs * config.completionThresholdRatio;
    return reachedEndByListening || listenedFullRatio;
  }

  return false;
}

/**
 * Determines whether a manual skip is an early skip (indicating disinterest or accidental tap)
 * versus a late transition (user listened to most of the song and transitioned near the end).
 */
export function isEarlySkip(
  actualListenMs: number,
  positionMs: number,
  trackDurationMs: number,
  config: PlayQualificationConfig = DEFAULT_QUALIFICATION_CONFIG
): boolean {
  // If actual listening exceeds the meaningful play threshold, it is NOT an early skip
  if (actualListenMs >= config.earlySkipThresholdMs) {
    return false;
  }

  if (trackDurationMs > 0) {
    const listenRatio = actualListenMs / trackDurationMs;
    const posRatio = positionMs / trackDurationMs;
    return (
      actualListenMs < config.earlySkipThresholdMs ||
      listenRatio < config.earlySkipRatioThreshold ||
      posRatio < config.earlySkipRatioThreshold
    );
  }

  return actualListenMs < config.earlySkipThresholdMs;
}

/**
 * Determines whether a play should be categorized as a replay.
 * Same track restarted within replayWindowMs (5 minutes) of previous play.
 */
export function isReplay(
  previousTrackId: string | null | undefined,
  currentTrackId: string,
  previousPlayTime: number,
  currentTime: number,
  config: PlayQualificationConfig = DEFAULT_QUALIFICATION_CONFIG
): boolean {
  if (!previousTrackId || previousTrackId !== currentTrackId) {
    return false;
  }
  const delta = currentTime - previousPlayTime;
  return delta >= 0 && delta <= config.replayWindowMs;
}

/**
 * Returns any unreached checkpoint ratio that has now been reached by position or actual listening.
 */
export function getReachedCheckpoints(
  positionMs: number,
  trackDurationMs: number,
  alreadyReached: ReadonlySet<number>,
  config: PlayQualificationConfig = DEFAULT_QUALIFICATION_CONFIG
): number[] {
  if (trackDurationMs <= 0) return [];
  const currentRatio = positionMs / trackDurationMs;
  const newlyReached: number[] = [];

  for (const checkpoint of config.progressCheckpoints) {
    if (!alreadyReached.has(checkpoint) && currentRatio >= checkpoint) {
      newlyReached.push(checkpoint);
    }
  }

  return newlyReached;
}
