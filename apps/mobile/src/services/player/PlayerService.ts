/**
 * Single player orchestration layer. UI talks to `playerService`, which
 * resolves playback sources through the API, drives the native player, and
 * mirrors playback state into the player store.
 *
 * Robustness rules:
 * - Commands (play/pause/seek/next/previous/load) are serialized through a
 *   promise chain so rapid taps can never interleave mid-flight.
 * - Every load gets a generation token; async continuations bail out if a
 *   newer command superseded them.
 * - Completion events only advance the queue when they belong to the current
 *   track and playback actually started (`hasStarted`). This prevents the
 *   "ended -> reload -> ended" loop when a load never really begins.
 * - Progress events only ever promote `loading` -> `playing`; nothing else can
 *   change status from the progress callback.
 */
import type { CanonicalTrack } from '@sinc/shared';
import { musicApi } from '../../api/music';
import { nativeBridge } from '../native';
import { useLibraryStore } from '../library/libraryStore';
import { recordPlay } from '../library/sync';
import { useDownloadsStore, mimeForLocalUri } from '../library/downloadsStore';
import { useLyricsStore } from '../lyrics/lyricsStore';
import { track } from '../analytics/analytics';
import type { NativeProgressEvent } from '../native/types';
import { selectCurrentTrack, usePlayerStore } from './playerStore';
import { usePlayerProgressStore } from './playerProgressStore';

class PlayerService {
  private initialized = false;
  /** True once the native player actually started playing the current load. */
  private hasStarted = false;
  /** Id of the track already recorded as "recently played" for the current load. */
  private recordedTrackId: string | null = null;
  /** Bumped on every load so stale async work is discarded. */
  private generation = 0;
  /** Serializes commands to keep rapid taps from interleaving. */
  private commandChain: Promise<unknown> = Promise.resolve();

  /** Runs a command after every previously queued command has settled. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.commandChain.then(task);
    this.commandChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  get isNativeAvailable(): boolean {
    return nativeBridge.player.available();
  }

  /** Subscribe to native events exactly once per service lifetime. */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    const player = nativeBridge.player;
    player.addProgressListener((event) => this.onProgress(event));
    player.addCompletionListener((trackId) => {
      void this.enqueue(() => this.handleCompletion(trackId));
    });
    player.addErrorListener((message) => this.onError(message));
    player.addCommandListener((command) => {
      // next()/previous() serialize themselves through the command chain;
      // wrapping them in another enqueue here would deadlock the chain.
      if (command === 'next') void this.next();
      else if (command === 'previous') void this.previous();
    });
  }

  playQueue(tracks: CanonicalTrack[], startIndex = 0): Promise<void> {
    this.initialize();
    usePlayerStore.getState().playQueue(tracks, startIndex);
    return this.enqueue(() => this.loadAndPlayCurrent());
  }

  playTrack(track: CanonicalTrack): Promise<void> {
    this.initialize();
    usePlayerStore.getState().playTrack(track);
    return this.enqueue(() => this.loadAndPlayCurrent());
  }

  togglePlayPause(): Promise<void> {
    this.initialize();
    return this.enqueue(async () => {
      const store = usePlayerStore.getState();

      if (store.status === 'playing') {
        this.hasStarted = true;
        await nativeBridge.player.pause();
        store.setStatus('paused');
        return;
      }
      if (store.status === 'loading' || !selectCurrentTrack(store)) return;
      if (store.status === 'error' || store.status === 'ended' || !this.hasStarted) {
        await this.loadAndPlayCurrent();
        return;
      }
      await nativeBridge.player.play();
      store.setStatus('playing');
    });
  }

  next(): Promise<void> {
    this.initialize();
    return this.enqueue(async () => {
      const store = usePlayerStore.getState();
      store.next();
      if (store.status === 'ended') {
        await nativeBridge.player.stop();
        return;
      }
      await this.loadAndPlayCurrent();
    });
  }

  previous(): Promise<void> {
    this.initialize();
    return this.enqueue(async () => {
      const store = usePlayerStore.getState();
      store.previous();
      if (store.status === 'ended') {
        await nativeBridge.player.stop();
        return;
      }
      await this.loadAndPlayCurrent();
    });
  }

  seekTo(positionMs: number): Promise<void> {
    this.initialize();
    return this.enqueue(async () => {
      const progress = usePlayerProgressStore.getState();
      progress.setProgress(positionMs, progress.durationMs);
      await nativeBridge.player.seekTo(positionMs);
    });
  }

  stop(): Promise<void> {
    this.initialize();
    return this.enqueue(async () => {
      this.invalidateLoad();
      await nativeBridge.player.stop();
      const store = usePlayerStore.getState();
      store.setStatus('idle');
      usePlayerProgressStore.getState().reset();
    });
  }

  /** Invalidates any in-flight load so its continuations become no-ops. */
  private invalidateLoad(): void {
    this.generation += 1;
    this.hasStarted = false;
  }

  private onProgress(event: NativeProgressEvent): void {
    if (event.isPlaying) {
      this.hasStarted = true;
      if (event.trackId && this.recordedTrackId !== event.trackId) {
        this.recordedTrackId = event.trackId;
        const current = selectCurrentTrack(usePlayerStore.getState());
        if (current && current.id === event.trackId) {
          useLibraryStore.getState().recordPlayed(current);
          recordPlay(current);
          track('playback:start', current.id);
        }
      }
    }
    const store = usePlayerStore.getState();
    usePlayerProgressStore.getState().setProgress(event.positionMs, event.durationMs);
    if (event.isPlaying && store.status === 'loading') {
      store.setStatus('playing');
    }
  }

  private onError(message: string): void {
    const store = usePlayerStore.getState();
    store.setError(message);
    store.setStatus('error');
  }

  private async handleCompletion(trackId: string): Promise<void> {
    const store = usePlayerStore.getState();
    const current = selectCurrentTrack(store);

    // Event from a superseded player/load: ignore it.
    if (!current || current.id !== trackId) return;

    if (!this.hasStarted) {
      // The track never actually played (failed/instant load). Surface an
      // error instead of advancing or re-queuing forever.
      store.setError('Playback failed to start');
      store.setStatus('error');
      await nativeBridge.player.stop();
      return;
    }

    if (store.repeat === 'one') {
      await this.loadAndPlayCurrent();
      return;
    }

    track('playback:complete', trackId);
    store.next();
    if (store.status === 'ended') {
      await nativeBridge.player.stop();
      return;
    }
    await this.loadAndPlayCurrent();
  }

  private async loadAndPlayCurrent(): Promise<void> {
    const store = usePlayerStore.getState();
    const track = selectCurrentTrack(store);
    if (!track) return;

    const generation = ++this.generation;
    this.hasStarted = false;
    this.recordedTrackId = null;
    store.setStatus('loading');
    store.setError(null);

    // Warm the lyrics cache for this track in parallel with stream
    // resolution so the lyrics screen renders instantly.
    void useLyricsStore
      .getState()
      .loadLyrics(track)
      .catch(() => undefined);

    try {
      const download = useDownloadsStore.getState().getDownload(track.id);
      let uri: string;
      let mimeType: string;
      if (download?.localUri) {
        uri = download.localUri;
        mimeType = mimeForLocalUri(download.localUri);
      } else {
        const resolved = await musicApi.resolvePlayback(track.id);
        uri = resolved.uri;
        mimeType = resolved.mimeType;
      }
      if (generation !== this.generation) return;
      await nativeBridge.player.load(track.id, uri, mimeType, undefined, {
        title: track.title,
        artist: track.artists.map((a) => a.name).join(', '),
        artworkUrl: track.artworkUrl,
      });
      if (generation !== this.generation) return;
      void nativeBridge.player.requestNotificationPermission();
      if (generation !== this.generation) return;
      await nativeBridge.player.play();
      if (generation !== this.generation) return;
      store.setStatus('playing');
    } catch (err) {
      if (generation !== this.generation) return;
      store.setError(err instanceof Error ? err.message : 'Failed to load track');
      store.setStatus('error');
    }
  }
}

export const playerService = new PlayerService();
