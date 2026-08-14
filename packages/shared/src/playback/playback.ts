/**
 * Playback state machine shared by UI state and native audio engine sync.
 */

export const PlaybackState = {
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  BUFFERING: 'BUFFERING',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  ENDED: 'ENDED',
  ERROR: 'ERROR',
} as const;

export type PlaybackState = (typeof PlaybackState)[keyof typeof PlaybackState];

export const PLAYBACK_TRANSITIONS: Record<PlaybackState, readonly PlaybackState[]> = {
  IDLE: ['LOADING', 'ERROR'],
  LOADING: ['BUFFERING', 'PLAYING', 'PAUSED', 'ERROR', 'IDLE'],
  BUFFERING: ['PLAYING', 'PAUSED', 'ERROR', 'IDLE'],
  PLAYING: ['PAUSED', 'BUFFERING', 'ENDED', 'ERROR'],
  PAUSED: ['PLAYING', 'BUFFERING', 'ENDED', 'ERROR'],
  ENDED: ['PLAYING', 'LOADING', 'IDLE'],
  ERROR: ['IDLE', 'LOADING', 'PLAYING'],
};

export type ShuffleMode = 'OFF' | 'ON' | 'SMART';
export type RepeatMode = 'OFF' | 'ONE' | 'ALL';
export type PlaybackSourceKind = 'LOCAL' | 'REMOTE' | 'CACHED';

export class PlaybackStateMachine {
  private state: PlaybackState = PlaybackState.IDLE;

  current(): PlaybackState {
    return this.state;
  }

  canTransition(to: PlaybackState): boolean {
    return PLAYBACK_TRANSITIONS[this.state].includes(to);
  }

  /** Throws on invalid transition. */
  transition(to: PlaybackState): PlaybackState {
    if (!this.canTransition(to)) {
      throw new Error(`Invalid playback transition: ${this.state} -> ${to}`);
    }
    this.state = to;
    return this.state;
  }

  reset(): void {
    this.state = PlaybackState.IDLE;
  }
}

export interface PlaybackPositionState {
  positionMs: number;
  durationMs: number;
  playbackRate: number;
}

export interface PlaybackError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface QueueTrackRef {
  trackId: string;
  playbackSource: PlaybackSourceKind;
}
