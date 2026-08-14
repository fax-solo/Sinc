import { describe, it, expect } from 'vitest';
import {
  DownloadStateMachine,
  DownloadStatus,
  PlaybackStateMachine,
  PlaybackState,
} from '../index.js';

describe('DownloadStateMachine', () => {
  const sm = () => new DownloadStateMachine();

  it('follows the happy path', () => {
    const m = sm();
    const path: DownloadStatus[] = [
      DownloadStatus.QUEUED,
      DownloadStatus.RESOLVING,
      DownloadStatus.DOWNLOADING,
      DownloadStatus.PROCESSING,
      DownloadStatus.FETCHING_LYRICS,
      DownloadStatus.FINALIZING,
      DownloadStatus.COMPLETED,
    ];
    for (let i = 1; i < path.length; i++) {
      m.transition(path[i - 1]!, path[i]!);
    }
    expect(m.canTransition(DownloadStatus.COMPLETED, DownloadStatus.FAILED)).toBe(false);
  });

  it('rejects QUEUED -> COMPLETED', () => {
    expect(() => sm().transition(DownloadStatus.QUEUED, DownloadStatus.COMPLETED)).toThrow();
  });

  it('allows retry from FAILED -> QUEUED', () => {
    expect(sm().canTransition(DownloadStatus.FAILED, DownloadStatus.QUEUED)).toBe(true);
  });

  it('treats COMPLETED as terminal', () => {
    expect(sm().canTransition(DownloadStatus.COMPLETED, DownloadStatus.FAILED)).toBe(false);
    expect(sm().canTransition(DownloadStatus.CANCELLED, DownloadStatus.QUEUED)).toBe(false);
  });

  it('allows pause/resume', () => {
    expect(sm().canTransition(DownloadStatus.DOWNLOADING, DownloadStatus.PAUSED)).toBe(true);
    expect(sm().canTransition(DownloadStatus.PAUSED, DownloadStatus.QUEUED)).toBe(true);
  });

  it('allows cancel at any active stage', () => {
    for (const from of [
      DownloadStatus.QUEUED,
      DownloadStatus.RESOLVING,
      DownloadStatus.DOWNLOADING,
      DownloadStatus.PAUSED,
    ]) {
      expect(sm().canTransition(from, DownloadStatus.CANCELLED)).toBe(true);
    }
  });

  it('allows FAILED -> CANCELLED', () => {
    expect(sm().canTransition(DownloadStatus.FAILED, DownloadStatus.CANCELLED)).toBe(true);
  });
});

describe('PlaybackStateMachine', () => {
  it('moves through load -> playing -> paused -> ended', () => {
    const m = new PlaybackStateMachine();
    m.transition(PlaybackState.LOADING);
    m.transition(PlaybackState.PLAYING);
    m.transition(PlaybackState.PAUSED);
    m.transition(PlaybackState.PLAYING);
    m.transition(PlaybackState.ENDED);
    expect(m.current()).toBe(PlaybackState.ENDED);
  });

  it('rejects IDLE -> PLAYING', () => {
    const m = new PlaybackStateMachine();
    expect(() => m.transition(PlaybackState.PLAYING)).toThrow();
  });

  it('allows PLAYING -> BUFFERING', () => {
    const m = new PlaybackStateMachine();
    m.transition(PlaybackState.LOADING);
    m.transition(PlaybackState.PLAYING);
    m.transition(PlaybackState.BUFFERING);
    expect(m.current()).toBe(PlaybackState.BUFFERING);
  });

  it('recovers from ERROR back to IDLE/LOADING', () => {
    const m = new PlaybackStateMachine();
    m.transition(PlaybackState.LOADING);
    m.transition(PlaybackState.ERROR);
    m.transition(PlaybackState.LOADING);
    expect(m.current()).toBe(PlaybackState.LOADING);
  });
});
