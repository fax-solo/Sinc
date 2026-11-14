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
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { nativeBridge } from '../native';
import { useLibraryStore } from '../library/libraryStore';
import { recordPlay } from '../library/sync';
import { useDownloadsStore, mimeForLocalUri } from '../library/downloadsStore';
import { useLyricsStore } from '../lyrics/lyricsStore';
import { track } from '../analytics/analytics';
import type { NativePlaybackState, NativeProgressEvent } from '../native/types';
import { selectCurrentTrack, usePlayerStore } from './playerStore';
import { usePlayerProgressStore } from './playerProgressStore';

/**
 * Recently resolved stream URLs. googlevideo URLs live ~6h; entries younger
 * than the TTL play instantly without waiting for a fresh yt-dlp resolve.
 * A stale entry that fails playback falls back to a fresh resolve once.
 */
const STREAM_CACHE_TTL_MS = 5 * 60 * 60 * 1000;
const STREAM_CACHE_MAX = 50;

interface CachedStream {
  uri: string;
  mimeType?: string;
  at: number;
}

function readStreamCache(): Record<string, CachedStream> {
  return storage.getObject<Record<string, CachedStream>>(STORAGE_KEYS.STREAM_CACHE) ?? {};
}

function getCachedStream(trackId: string): CachedStream | null {
  const entry = readStreamCache()[trackId];
  if (!entry || Date.now() - entry.at > STREAM_CACHE_TTL_MS) return null;
  return entry;
}

function putCachedStream(trackId: string, uri: string, mimeType?: string): void {
  const cache = readStreamCache();
  cache[trackId] = { uri, mimeType, at: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > STREAM_CACHE_MAX) {
    const oldest = keys
      .map((k) => [k, cache[k].at] as const)
      .sort((a, b) => a[1] - b[1])
      .slice(0, keys.length - STREAM_CACHE_MAX);
    for (const [k] of oldest) delete cache[k];
  }
  storage.setObject(STORAGE_KEYS.STREAM_CACHE, cache);
}

function clearCachedStream(trackId: string): void {
  const cache = readStreamCache();
  if (cache[trackId] === undefined) return;
  delete cache[trackId];
  storage.setObject(STORAGE_KEYS.STREAM_CACHE, cache);
}

class PlayerService {
  private initialized = false;
  /** Track id currently playing from a cached URL (enables one fresh retry). */
  private staleTrackId: string | null = null;
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
    player.addStateListener((event) => this.onState(event));
    player.addCommandListener((event) => {
      // next()/previous() serialize themselves through the command chain;
      // wrapping them in another enqueue here would deadlock the chain.
      if (event.command === 'next') void this.next();
      else if (event.command === 'previous') void this.previous();
      else if (event.command === 'favorite') void this.handleFavoriteCommand(event.trackId);
    });
    useLibraryStore.subscribe((state, previous) => {
      if (state.favoriteIds === previous.favoriteIds) return;
      const current = selectCurrentTrack(usePlayerStore.getState());
      if (!current) return;
      void nativeBridge.player
        .setFavorite(state.favoriteIds.has(current.id))
        .catch(() => undefined);
    });
    void this.syncFromNative();
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

  /** Add a track after the queue. Starts playback if the queue was empty. */
  addToQueue(track: CanonicalTrack): Promise<boolean> {
    this.initialize();
    const before = selectCurrentTrack(usePlayerStore.getState());
    const added = usePlayerStore.getState().addToQueue(track);
    if (!added) return Promise.resolve(false);
    return before
      ? Promise.resolve(true)
      : this.enqueue(() => this.loadAndPlayCurrent()).then(() => true);
  }

  /** Append an album/playlist, skipping duplicates already in the queue. */
  addTracksToQueue(tracks: CanonicalTrack[]): Promise<number> {
    this.initialize();
    const before = selectCurrentTrack(usePlayerStore.getState());
    const added = usePlayerStore.getState().addTracksToQueue(tracks);
    if (added === 0) return Promise.resolve(0);
    if (before) return Promise.resolve(added);
    return this.enqueue(() => this.loadAndPlayCurrent()).then(() => added);
  }

  /** Insert one track immediately after the current one. */
  playNext(track: CanonicalTrack): Promise<boolean> {
    this.initialize();
    const before = selectCurrentTrack(usePlayerStore.getState());
    const added = usePlayerStore.getState().playNext(track);
    if (!added) return Promise.resolve(false);
    return before
      ? Promise.resolve(true)
      : this.enqueue(() => this.loadAndPlayCurrent()).then(() => true);
  }

  /** Jump to an absolute index in the queue and start it. */
  jumpToQueueIndex(index: number): Promise<void> {
    this.initialize();
    return this.enqueue(async () => {
      const moved = usePlayerStore.getState().jumpTo(index);
      if (!moved) return;
      await this.loadAndPlayCurrent();
    });
  }

  /** Removing/reordering upcoming items never touches the current audio. */
  removeFromQueue(index: number): boolean {
    return usePlayerStore.getState().removeFromQueue(index);
  }

  reorderQueue(fromIndex: number, toIndex: number): boolean {
    return usePlayerStore.getState().reorderQueue(fromIndex, toIndex);
  }

  /** Stops audio and empties the queue. Callers should confirm first. */
  clearQueue(): Promise<void> {
    this.initialize();
    return this.enqueue(async () => {
      this.invalidateLoad();
      await this.stopSoftly();
      usePlayerStore.getState().clearQueue();
    });
  }

  setShuffle(enabled: boolean): void {
    usePlayerStore.getState().setShuffle(enabled ? 'on' : 'off');
  }

  setRepeatMode(mode: 'off' | 'one' | 'all'): void {
    usePlayerStore.getState().setRepeat(mode);
  }

  /** Retry a failed load of the current queue item. */
  retry(): Promise<void> {
    this.initialize();
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
      // Pausing mid-resolve: invalidate the in-flight load (its continuations
      // become no-ops via the generation token) and make sure the native
      // player — which may finish loading a moment later — ends up paused.
      // Because commands serialize through the queue, this runs after the
      // in-flight load settles, so the pause always wins.
      if (store.status === 'loading') {
        this.invalidateLoad();
        try {
          await nativeBridge.player.pause();
        } catch {
          // Native may be idle; the status is what the UI follows.
        }
        store.setStatus('paused');
        return;
      }
      if (!selectCurrentTrack(store)) return;
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
      this.recordSkipped(store);
      store.next();
      // Snapshot caveat: re-read after the mutation (see handleCompletion).
      if (usePlayerStore.getState().status === 'ended') {
        // Exhausted queue: silence the audio but keep the media session so the
        // notification and lockscreen controls stay available (resume/replay).
        try {
          await nativeBridge.player.pause();
        } catch {
          // Native may already be idle; the store status is still correct.
        }
        return;
      }
      await this.loadAndPlayCurrent();
    });
  }

  previous(): Promise<void> {
    this.initialize();
    return this.enqueue(async () => {
      const store = usePlayerStore.getState();
      const current = selectCurrentTrack(store);
      const progress = usePlayerProgressStore.getState();
      // Familiar player behaviour: inside the track, "previous" restarts it;
      // only near the beginning does it move to the previous queue item.
      if (
        current &&
        (store.status === 'playing' || store.status === 'paused') &&
        progress.positionMs > 3_000
      ) {
        await nativeBridge.player.seekTo(0);
        progress.setProgress(0, progress.durationMs);
        return;
      }
      this.recordSkipped(store);
      // previous() always lands on a valid index with status 'loading'
      // (playerStore.previous clamps at 0) — no end-of-queue branch exists.
      store.previous();
      if (usePlayerStore.getState().status === 'ended') {
        await this.stopSoftly();
        return;
      }
      await this.loadAndPlayCurrent();
    });
  }

  /**
   * A manual next/previous counts as a skip only when it happens early. The
   * old rule counted a tap at 95% (or after a pause near the end) too, which
   * could blacklist songs the listener actually finished.
   */
  private recordSkipped(store: ReturnType<typeof usePlayerStore.getState>): void {
    if (store.status !== 'playing' && store.status !== 'paused') return;
    const current = selectCurrentTrack(store);
    if (!current) return;
    const progress = usePlayerProgressStore.getState();
    const duration = progress.durationMs;
    const early =
      progress.positionMs < 30_000 || (duration > 0 && progress.positionMs / duration < 0.25);
    if (early) useLibraryStore.getState().recordSkip(current);
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
    this.staleTrackId = null;
  }

  private onProgress(event: NativeProgressEvent): void {
    if (event.isPlaying) {
      this.hasStarted = true;
      if (event.trackId && this.recordedTrackId !== event.trackId) {
        this.recordedTrackId = event.trackId;
        const current = selectCurrentTrack(usePlayerStore.getState());
        if (current && current.id === event.trackId) {
          useLibraryStore.getState().recordPlayed(current);
          useLibraryStore.getState().recordPlayStarted(current);
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

  /** Restores the store from the still-running service after app start/reload. */
  private async syncFromNative(): Promise<void> {
    try {
      const snapshot = await nativeBridge.player.getState();
      if (snapshot) this.onState(snapshot);
    } catch {
      // No native session yet; the store simply stays idle.
    }
  }

  /**
   * Native owns the actual transport; JS owns the queue/user intent. Progress
   * events only ever promote `loading` to playing, but transport snapshots are
   * authoritative when the change came from the notification or lockscreen.
   */
  private onState(event: NativePlaybackState): void {
    const store = usePlayerStore.getState();
    const current = selectCurrentTrack(store);
    if (event.trackId && current && event.trackId !== current.id) {
      // A stale snapshot from a track that no longer owns the session.
      return;
    }
    usePlayerProgressStore.getState().setProgress(event.positionMs, event.durationMs);
    if (event.isPlaying) this.hasStarted = true;

    switch (event.playbackState) {
      case 'ready':
        if (event.isPlaying) {
          if (store.status !== 'playing') store.setStatus('playing');
        } else if (store.status === 'playing' || store.status === 'loading') {
          store.setStatus('paused');
        }
        break;
      case 'buffering':
        if (store.status === 'idle' || store.status === 'ended') store.setStatus('loading');
        break;
      case 'ended':
        if (store.status === 'playing' || store.status === 'paused') store.setStatus('ended');
        break;
      case 'idle':
        if (store.status !== 'idle' && store.status !== 'error') store.setStatus('idle');
        break;
      default:
        break;
    }
  }

  /** Notification heart tap. The library store remains the favorite authority. */
  private async handleFavoriteCommand(trackId?: string): Promise<void> {
    const current = selectCurrentTrack(usePlayerStore.getState());
    if (!current || (trackId && trackId !== current.id)) return;
    // The library-store subscription registered in initialize() mirrors the
    // new state to the native session, so no direct push is needed here.
    useLibraryStore.getState().toggleFavorite(current);
  }

  private onError(message: string): void {
    // A cached stream URL may have expired server-side (or been revoked):
    // drop it and resolve fresh once instead of stranding the user on error.
    if (this.staleTrackId) {
      const trackId = this.staleTrackId;
      this.staleTrackId = null;
      // Capture the dead URL before clearing the JS cache: the native module
      // may still serve the very same URL from its resolve caches, and a
      // fresh re-resolve must not just hand it back.
      const dead = getCachedStream(trackId);
      clearCachedStream(trackId);
      if (dead && typeof nativeBridge.yt?.evictStream === 'function') {
        void nativeBridge.yt.evictStream(dead.uri).catch(() => false);
      }
      console.warn('Sinc cached stream failed, resolving fresh:', message);
      void this.enqueue(() => this.loadAndPlayCurrent());
      return;
    }
    console.warn('Sinc player native error:', message);
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
      await this.stopSoftly();
      return;
    }

    if (store.repeat === 'one') {
      await this.loadAndPlayCurrent();
      return;
    }

    // The current track actually played to completion.
    useLibraryStore.getState().recordPlayCompleted(current);
    track('playback:complete', trackId);
    store.next();
    // Re-read state: `store` is a snapshot — after next() the queue may have
    // moved to 'ended' (repeat off, queue exhausted). Keep the media session
    // alive on the last track so the notification/lockscreen controls remain:
    // the native routing player rewinds to 0 when play is pressed from ENDED.
    if (usePlayerStore.getState().status === 'ended') {
      return;
    }
    await this.loadAndPlayCurrent();
  }

  /** Best-effort stop that never rejects on the fire-and-forget paths. */
  private async stopSoftly(): Promise<void> {
    try {
      await nativeBridge.player.stop();
    } catch {
      // The native session is already releasing/end-of-queue; nothing to do.
    }
  }

  private async loadAndPlayCurrent(): Promise<void> {
    const store = usePlayerStore.getState();
    const track = selectCurrentTrack(store);
    if (!track) return;

    const generation = ++this.generation;
    this.hasStarted = false;
    this.recordedTrackId = null;
    this.staleTrackId = null;
    store.setStatus('loading');
    store.setError(null);
    // Drop the previous track's position/length immediately so the seek bar,
    // durations and lyrics highlight never show stale data for the new song.
    // The known catalog length seeds the bar until the player reports real values.
    usePlayerProgressStore.getState().setProgress(0, Math.max(0, track.durationMs ?? 0));

    // Warm the lyrics cache for this track in parallel with stream
    // resolution so the lyrics screen renders instantly.
    void useLyricsStore
      .getState()
      .loadLyrics(track)
      .catch(() => undefined);
    // And pre-warm the next couple of queue entries so flipping "up next"
    // never waits on a cold lyric fetch. warmLyrics serializes internally
    // and skips anything already cached or negatively cached.
    const upNext =
      store.currentIndex >= 0
        ? store.queue.slice(store.currentIndex + 1, store.currentIndex + 3)
        : [];
    if (upNext.length > 0) {
      void useLyricsStore.getState().warmLyrics(upNext);
    }

    try {
      const download = useDownloadsStore.getState().getDownload(track.id);
      let uri: string;
      let mimeType: string | undefined;
      if (download?.localUri) {
        uri = download.localUri;
        mimeType = mimeForLocalUri(download.localUri);
      } else {
        // A fresh cached URL (< 5h) plays instantly; otherwise resolve (with
        // retries for flaky mobile networks) and remember the URL for next time.
        const cached = getCachedStream(track.id);
        if (cached) {
          uri = cached.uri;
          mimeType = cached.mimeType;
          this.staleTrackId = track.id;
        } else {
          let resolved: Awaited<ReturnType<typeof musicApi.resolvePlaybackForTrack>> | null = null;
          let resolveError: unknown = null;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            if (generation !== this.generation) return;
            try {
              resolved = await musicApi.resolvePlaybackForTrack(track);
              resolveError = null;
              break;
            } catch (err) {
              resolveError = err;
              if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
            }
          }
          if (generation !== this.generation) return;
          if (!resolved?.uri) {
            throw resolveError instanceof Error
              ? resolveError
              : new Error('No playable source was found');
          }
          uri = resolved.uri;
          mimeType = resolved.mimeType;
          putCachedStream(track.id, uri, mimeType);
        }
      }
      if (generation !== this.generation) return;
      await nativeBridge.player.load(track.id, uri, mimeType, undefined, {
        title: track.title,
        artist: track.artists.map((a) => a.name).join(', '),
        albumTitle: track.album?.title,
        artworkUrl: track.artworkUrl,
        durationMs: track.durationMs > 0 ? track.durationMs : undefined,
        favorite: useLibraryStore.getState().favoriteIds.has(track.id),
      });
      if (generation !== this.generation) return;
      void nativeBridge.player.requestNotificationPermission();
      if (generation !== this.generation) return;
      await nativeBridge.player.play();
      if (generation !== this.generation) return;
      store.setStatus('playing');
      this.prefetchUpcoming();
    } catch (err) {
      if (generation !== this.generation) return;
      const message = err instanceof Error ? err.message : 'Failed to load track';
      console.warn('Sinc playback failed:', message);
      store.setError(message);
      store.setStatus('error');
    }
  }

  /**
   * Resolves the next queued track(s) in the background so pressing next (or
   * the queue simply advancing) starts from cache instead of waiting on a
   * fresh yt-dlp search, which is what made skipping feel slow.
   */
  private prefetchUpcoming(): void {
    // Prefetching is a pure optimisation: a missing/older bridge must never
    // turn a playing track into an error.
    if (typeof nativeBridge.yt?.prefetch !== 'function') return;
    if (!nativeBridge.yt.available?.()) return;
    const { queue, currentIndex, shuffle } = usePlayerStore.getState();
    if (queue.length < 2) return;
    const indices: number[] = [];
    if (shuffle === 'on') {
      // Two distinct random picks from the rest of the queue.
      const pool = queue.map((_, i) => i).filter((i) => i !== currentIndex);
      for (let pick = 0; pick < 2 && pool.length > 0; pick += 1) {
        const idx = Math.floor(Math.random() * pool.length);
        indices.push(pool[idx]);
        pool.splice(idx, 1);
      }
    } else {
      if (currentIndex + 1 < queue.length) indices.push(currentIndex + 1);
      if (currentIndex + 2 < queue.length) indices.push(currentIndex + 2);
    }
    for (const idx of indices) {
      const next = queue[idx];
      if (next) this.warmTrack(next);
    }
  }

  /** Cooldown per track so queue churn or repeat list-opens never prefetch-storm. */
  private static readonly WARM_COOLDOWN_MS = 4 * 60 * 1000;
  private warmedAt = new Map<string, number>();

  /** Fire-and-forget stream-cache warm for one track (used ahead of play). */
  private warmTrack(track: CanonicalTrack): void {
    if (typeof nativeBridge.yt?.prefetch !== 'function') return;
    if (!nativeBridge.yt.available?.()) return;
    // Locally downloaded tracks play straight from disk; nothing to resolve.
    if (useDownloadsStore.getState().getDownload(track.id)?.localUri) return;
    // Already resolvable instantly from the persistent JS cache.
    if (getCachedStream(track.id)) return;
    const last = this.warmedAt.get(track.id) ?? 0;
    if (Date.now() - last < PlayerService.WARM_COOLDOWN_MS) return;
    this.warmedAt.set(track.id, Date.now());
    void nativeBridge.yt
      .prefetch(
        track.artists[0]?.name ?? '',
        track.title,
        track.durationMs > 0 ? track.durationMs : null
      )
      .catch(() => false);
  }

  /**
   * Warms the head track of a list the user just opened (album/playlist/detail
   * screens) so their most likely first tap hits the cache and starts
   * instantly. Fire-and-forget, cooldown-guarded.
   */
  warmUpcoming(tracks: CanonicalTrack[]): void {
    const head = tracks[0];
    if (head) this.warmTrack(head);
  }
}

export const playerService = new PlayerService();
