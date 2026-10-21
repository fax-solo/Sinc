import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import type {
  NativeDownloaderModule,
  NativePlayerCommand,
  NativePlayerModule,
  NativeProgressEvent,
} from '../native/types';
import { playerService } from './PlayerService';
import { usePlayerStore } from './playerStore';
import { usePlayerProgressStore } from './playerProgressStore';
import { storage, STORAGE_KEYS } from '../../utils/storage';

// The native keystore is unavailable under Node; keep anything that reaches
// for it inert.
vi.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whitelist' },
  ACCESS_CONTROL: { BIOMETRY_CURRENT_SET: 'biometryCurrentSet' },
  setGenericPassword: vi.fn(async () => ({ service: 'default', storage: 'keychain' })),
  getGenericPassword: vi.fn(async () => false),
  resetGenericPassword: vi.fn(async () => true),
}));

type ProgressListener = (event: NativeProgressEvent) => void;
type CompletionListener = (trackId: string) => void;
type ErrorListener = (message: string) => void;
type CommandListener = (command: NativePlayerCommand) => void;

const {
  progressListeners,
  completionListeners,
  errorListeners,
  commandListeners,
  fakePlayer,
  fakeDownloader,
  fakeYt,
  resolvePlayback,
} = vi.hoisted(() => {
  const progressListeners: ProgressListener[] = [];
  const completionListeners: CompletionListener[] = [];
  const errorListeners: ErrorListener[] = [];
  const commandListeners: CommandListener[] = [];
  const resolvePlayback = vi.fn();

  const fakePlayer: NativePlayerModule = {
    available: () => true,
    load: vi.fn(async () => {}),
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    seekTo: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    addProgressListener: (listener) => {
      progressListeners.push(listener);
      return () => {};
    },
    addCompletionListener: (listener) => {
      completionListeners.push(listener);
      return () => {};
    },
    addErrorListener: (listener) => {
      errorListeners.push(listener);
      return () => {};
    },
    addCommandListener: (listener) => {
      commandListeners.push(listener);
      return () => {};
    },
    requestNotificationPermission: vi.fn(async () => {}),
  };

  const fakeDownloader: NativeDownloaderModule = {
    available: () => false,
    download: async () => {
      throw new Error('unavailable');
    },
    remove: async () => {},
    addProgressListener: () => () => {},
  };

  const fakeYt = {
    available: () => true,
    resolveStream: async () => null,
    resolveByQuery: async () => null,
    prefetch: vi.fn(async () => true),
    download: async () => null,
  };

  return {
    progressListeners,
    completionListeners,
    errorListeners,
    commandListeners,
    fakePlayer,
    fakeDownloader,
    fakeYt,
    resolvePlayback,
  };
});

vi.mock('../../api/music', () => ({
  musicApi: { resolvePlaybackForTrack: resolvePlayback },
}));

vi.mock('../native', () => ({
  nativeBridge: {
    player: fakePlayer,
    downloader: fakeDownloader,
    yt: fakeYt,
    downloads: {
      available: () => false,
      addActionListener: vi.fn(() => () => {}),
      addYtProgressListener: vi.fn(() => () => {}),
    },
  },
}));

function track(id: string): CanonicalTrack {
  return {
    id,
    title: `Track ${id}`,
    artists: [{ id: `a-${id}`, name: 'Artist', providerIds: {}, genres: [] }],
    durationMs: 1000,
    artworkUrl: undefined,
    providerIds: { itunes: id },
    explicit: false,
  };
}

function makeResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** Stubs the local playback resolver for the given tracks and blocks all real HTTP. */
function stubResolvePlayback(tracks: CanonicalTrack[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => makeResponse({ message: 'not found' }, 404))
  );
  resolvePlayback.mockReset();
  resolvePlayback.mockImplementation(async (t: CanonicalTrack) => {
    const match = tracks.find((c) => c.id === t.id);
    if (!match) throw new Error('no stream');
    return {
      uri: `https://example.com/${match.id}.m3u8`,
      mimeType: 'application/vnd.apple.mpegurl',
      quality: 'high' as const,
      provider: 'ytdlp' as const,
    };
  });
}

/** Simulates the native player reporting that playback actually started. */
function emitStartedPlaying() {
  progressListeners.forEach((l) =>
    l({ trackId: 'itunes:1', positionMs: 400, durationMs: 1000, isPlaying: true })
  );
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  storage.remove(STORAGE_KEYS.STREAM_CACHE);
  vi.mocked(fakePlayer.load).mockClear();
  vi.mocked(fakePlayer.play).mockClear();
  vi.mocked(fakePlayer.pause).mockClear();
  vi.mocked(fakePlayer.stop).mockClear();
  vi.mocked(fakePlayer.seekTo).mockClear();
  usePlayerStore.setState({
    status: 'idle',
    queue: [],
    currentIndex: -1,
    shuffle: 'off',
    repeat: 'off',
    errorMessage: null,
  });
  usePlayerProgressStore.setState({ positionMs: 0, durationMs: 0 });
});

describe('playerService', () => {
  it('isNativeAvailable reflects the bridge', () => {
    expect(playerService.isNativeAvailable).toBe(true);
  });

  it('playQueue resolves the stream, loads and plays the native track', async () => {
    stubResolvePlayback([track('itunes:1')]);

    await playerService.playQueue([track('itunes:1')]);

    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledWith(
      'itunes:1',
      'https://example.com/itunes:1.m3u8',
      'application/vnd.apple.mpegurl',
      undefined,
      {
        title: 'Track itunes:1',
        artist: 'Artist',
        artworkUrl: undefined,
      }
    );
    expect(vi.mocked(fakePlayer.play)).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().status).toBe('playing');
  });

  it('playTrack queues a single track and loads it', async () => {
    stubResolvePlayback([track('itunes:1')]);

    await playerService.playTrack(track('itunes:1'));

    expect(usePlayerStore.getState().queue).toHaveLength(1);
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(1);
  });

  it('prefetches the next queued track so skipping starts from cache', async () => {
    stubResolvePlayback([track('itunes:1'), track('itunes:2')]);

    await playerService.playQueue([track('itunes:1'), track('itunes:2')]);

    expect(vi.mocked(fakeYt.prefetch)).toHaveBeenCalledWith('Artist', 'Track itunes:2', 1000);
  });

  it('progress events update the store and promote loading to playing', async () => {
    stubResolvePlayback([track('itunes:1')]);
    await playerService.playQueue([track('itunes:1')]);
    usePlayerStore.setState({ status: 'loading' });

    emitStartedPlaying();

    const state = usePlayerStore.getState();
    expect(usePlayerProgressStore.getState().positionMs).toBe(400);
    expect(usePlayerProgressStore.getState().durationMs).toBe(1000);
    expect(state.status).toBe('playing');
  });

  it('progress events never downgrade playing to paused', async () => {
    stubResolvePlayback([track('itunes:1')]);
    await playerService.playQueue([track('itunes:1')]);
    usePlayerStore.setState({ status: 'playing' });

    progressListeners.forEach((l) =>
      l({ trackId: 'itunes:1', positionMs: 400, durationMs: 1000, isPlaying: false })
    );

    expect(usePlayerStore.getState().status).toBe('playing');
  });

  it('completion advances to the next track in the queue', async () => {
    const tracks = [track('itunes:1'), track('itunes:2')];
    stubResolvePlayback(tracks);
    await playerService.playQueue(tracks);
    emitStartedPlaying();

    completionListeners.forEach((l) => l('itunes:1'));
    await flush();

    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(vi.mocked(fakePlayer.load)).toHaveBeenLastCalledWith(
      'itunes:2',
      'https://example.com/itunes:2.m3u8',
      'application/vnd.apple.mpegurl',
      undefined,
      expect.objectContaining({ title: 'Track itunes:2' })
    );
  });

  it('completion with repeat one reloads the same track', async () => {
    const t1 = track('itunes:1');
    stubResolvePlayback([t1]);
    await playerService.playQueue([t1]);
    usePlayerStore.getState().setRepeat('one');
    emitStartedPlaying();

    completionListeners.forEach((l) => l('itunes:1'));
    await flush();

    expect(usePlayerStore.getState().currentIndex).toBe(0);
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(2);
  });

  it('completion before playback started surfaces an error instead of advancing', async () => {
    const tracks = [track('itunes:1'), track('itunes:2')];
    stubResolvePlayback(tracks);
    await playerService.playQueue(tracks);

    completionListeners.forEach((l) => l('itunes:1'));
    await flush();

    expect(usePlayerStore.getState().currentIndex).toBe(0);
    expect(usePlayerStore.getState().status).toBe('error');
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fakePlayer.stop)).toHaveBeenCalled();
  });

  it('a completion for a non-current track is ignored', async () => {
    const tracks = [track('itunes:1'), track('itunes:2')];
    stubResolvePlayback(tracks);
    await playerService.playQueue(tracks);
    emitStartedPlaying();

    completionListeners.forEach((l) => l('itunes:2'));
    await flush();

    expect(usePlayerStore.getState().currentIndex).toBe(0);
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(1);
  });

  it('togglePlayPause pauses a playing track', async () => {
    stubResolvePlayback([track('itunes:1')]);
    await playerService.playQueue([track('itunes:1')]);
    expect(usePlayerStore.getState().status).toBe('playing');

    await playerService.togglePlayPause();

    expect(vi.mocked(fakePlayer.pause)).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().status).toBe('paused');
  });

  it('togglePlayPause resumes a paused track', async () => {
    stubResolvePlayback([track('itunes:1')]);
    await playerService.playQueue([track('itunes:1')]);
    await playerService.togglePlayPause();
    expect(usePlayerStore.getState().status).toBe('paused');

    await playerService.togglePlayPause();

    expect(vi.mocked(fakePlayer.play)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().status).toBe('playing');
  });

  it('next advances and loads the following track', async () => {
    const tracks = [track('itunes:1'), track('itunes:2')];
    stubResolvePlayback(tracks);
    await playerService.playQueue(tracks);
    emitStartedPlaying();

    await playerService.next();

    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(2);
  });

  it('a lock-screen next command advances the queue', async () => {
    const tracks = [track('itunes:1'), track('itunes:2')];
    stubResolvePlayback(tracks);
    await playerService.playQueue(tracks);
    emitStartedPlaying();

    commandListeners.forEach((l) => l('next'));
    await flush();

    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(2);
  });

  it('a lock-screen previous command goes back in the queue', async () => {
    const tracks = [track('itunes:1'), track('itunes:2')];
    stubResolvePlayback(tracks);
    await playerService.playQueue(tracks, 1);
    emitStartedPlaying();

    commandListeners.forEach((l) => l('previous'));
    await flush();

    expect(usePlayerStore.getState().currentIndex).toBe(0);
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(2);
  });

  it('previous clamps at the first track', async () => {
    const tracks = [track('itunes:1'), track('itunes:2')];
    stubResolvePlayback(tracks);
    await playerService.playQueue(tracks, 1);
    emitStartedPlaying();

    await playerService.previous();

    expect(usePlayerStore.getState().currentIndex).toBe(0);
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(2);
  });

  it('seekTo updates the store and the native player', async () => {
    stubResolvePlayback([track('itunes:1')]);
    await playerService.playQueue([track('itunes:1')]);

    await playerService.seekTo(30000);

    expect(usePlayerProgressStore.getState().positionMs).toBe(30000);
    expect(vi.mocked(fakePlayer.seekTo)).toHaveBeenCalledWith(30000);
  });

  it('a failed stream resolve surfaces an error', async () => {
    stubResolvePlayback([track('itunes:1')]);
    resolvePlayback.mockRejectedValue(new Error('no stream'));

    await playerService.playTrack(track('itunes:1'));

    expect(usePlayerStore.getState().status).toBe('error');
    expect(usePlayerStore.getState().errorMessage).toBe('no stream');
    expect(vi.mocked(fakePlayer.load)).not.toHaveBeenCalled();
  });

  it('retries a flaky resolve before playing', async () => {
    stubResolvePlayback([track('itunes:1')]);
    resolvePlayback
      .mockRejectedValueOnce(new Error('flaky dns'))
      .mockRejectedValueOnce(new Error('flaky dns'));

    await playerService.playTrack(track('itunes:1'));

    // Two transient failures, then the stub's success path wins.
    expect(resolvePlayback).toHaveBeenCalledTimes(3);
    expect(usePlayerStore.getState().status).toBe('playing');
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(1);
  });

  it('pauses even while a track is still resolving', async () => {
    stubResolvePlayback([track('itunes:1')]);
    usePlayerStore.setState({
      status: 'loading',
      queue: [track('itunes:1')],
      currentIndex: 0,
    });

    await playerService.togglePlayPause();

    expect(usePlayerStore.getState().status).toBe('paused');
    expect(vi.mocked(fakePlayer.pause)).toHaveBeenCalled();
  });

  it('resets stale progress when a new track loads', async () => {
    stubResolvePlayback([track('itunes:1')]);
    usePlayerProgressStore.setState({ positionMs: 200000, durationMs: 300000 });

    await playerService.playTrack(track('itunes:1'));

    expect(usePlayerProgressStore.getState().positionMs).toBe(0);
    expect(usePlayerProgressStore.getState().durationMs).toBe(1000);
  });

  it('plays a fresh cached stream instantly without resolving', async () => {
    stubResolvePlayback([track('itunes:1')]);
    storage.setObject(STORAGE_KEYS.STREAM_CACHE, {
      'itunes:1': { uri: 'https://cdn.example/a.m4a', mimeType: 'audio/mp4', at: Date.now() },
    });

    await playerService.playTrack(track('itunes:1'));

    expect(resolvePlayback).not.toHaveBeenCalled();
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fakePlayer.load).mock.calls[0][1]).toBe('https://cdn.example/a.m4a');
    expect(usePlayerStore.getState().status).toBe('playing');
  });

  it('drops a dead cached stream and resolves fresh', async () => {
    stubResolvePlayback([track('itunes:1')]);
    storage.setObject(STORAGE_KEYS.STREAM_CACHE, {
      'itunes:1': { uri: 'https://cdn.example/dead.m4a', mimeType: 'audio/mp4', at: Date.now() },
    });

    await playerService.playTrack(track('itunes:1'));
    expect(usePlayerStore.getState().status).toBe('playing');

    playerService.initialize();
    errorListeners.forEach((l) => l('403 Forbidden'));
    await new Promise((r) => setTimeout(r, 50));

    expect(resolvePlayback).toHaveBeenCalled();
    const cache = storage.getObject<Record<string, { uri: string }>>(STORAGE_KEYS.STREAM_CACHE);
    expect(cache?.['itunes:1']?.uri).toBe('https://example.com/itunes:1.m3u8');
  });

  it('native errors surface into the store', async () => {
    playerService.initialize();
    errorListeners.forEach((l) => l('Player crashed'));

    expect(usePlayerStore.getState().status).toBe('error');
    expect(usePlayerStore.getState().errorMessage).toBe('Player crashed');
  });
});
