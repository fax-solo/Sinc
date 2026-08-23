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
} = vi.hoisted(() => {
  const progressListeners: ProgressListener[] = [];
  const completionListeners: CompletionListener[] = [];
  const errorListeners: ErrorListener[] = [];
  const commandListeners: CommandListener[] = [];

  const fakePlayer: NativePlayerModule = {
    available: () => true,
    load: vi.fn(async () => {}),
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    seekTo: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    getPosition: vi.fn(async () => 0),
    getDuration: vi.fn(async () => 0),
    isPlaying: vi.fn(async () => true),
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
    cancel: async () => {},
    remove: async () => {},
    getLocalUri: async () => null,
    addProgressListener: () => () => {},
  };

  return {
    progressListeners,
    completionListeners,
    errorListeners,
    commandListeners,
    fakePlayer,
    fakeDownloader,
  };
});

vi.mock('../native', () => ({
  nativeBridge: { player: fakePlayer, downloader: fakeDownloader },
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

function stubFetchForPlay(tracks: CanonicalTrack[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => {
      const path = decodeURIComponent(new URL(url).pathname);
      const match = tracks.find((t) => path === `/music/tracks/${t.id}/play`);
      if (!match) return makeResponse({ message: 'not found' }, 404);
      return makeResponse({
        uri: `https://example.com/${match.id}.m3u8`,
        mimeType: 'application/vnd.apple.mpegurl',
        quality: 'high',
        provider: 'ytdlp',
        expiresIn: 3600,
      });
    })
  );
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
    stubFetchForPlay([track('itunes:1')]);

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
    stubFetchForPlay([track('itunes:1')]);

    await playerService.playTrack(track('itunes:1'));

    expect(usePlayerStore.getState().queue).toHaveLength(1);
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(1);
  });

  it('progress events update the store and promote loading to playing', async () => {
    stubFetchForPlay([track('itunes:1')]);
    await playerService.playQueue([track('itunes:1')]);
    usePlayerStore.setState({ status: 'loading' });

    emitStartedPlaying();

    const state = usePlayerStore.getState();
    expect(usePlayerProgressStore.getState().positionMs).toBe(400);
    expect(usePlayerProgressStore.getState().durationMs).toBe(1000);
    expect(state.status).toBe('playing');
  });

  it('progress events never downgrade playing to paused', async () => {
    stubFetchForPlay([track('itunes:1')]);
    await playerService.playQueue([track('itunes:1')]);
    usePlayerStore.setState({ status: 'playing' });

    progressListeners.forEach((l) =>
      l({ trackId: 'itunes:1', positionMs: 400, durationMs: 1000, isPlaying: false })
    );

    expect(usePlayerStore.getState().status).toBe('playing');
  });

  it('completion advances to the next track in the queue', async () => {
    const tracks = [track('itunes:1'), track('itunes:2')];
    stubFetchForPlay(tracks);
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
    stubFetchForPlay([t1]);
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
    stubFetchForPlay(tracks);
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
    stubFetchForPlay(tracks);
    await playerService.playQueue(tracks);
    emitStartedPlaying();

    completionListeners.forEach((l) => l('itunes:2'));
    await flush();

    expect(usePlayerStore.getState().currentIndex).toBe(0);
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(1);
  });

  it('togglePlayPause pauses a playing track', async () => {
    stubFetchForPlay([track('itunes:1')]);
    await playerService.playQueue([track('itunes:1')]);
    expect(usePlayerStore.getState().status).toBe('playing');

    await playerService.togglePlayPause();

    expect(vi.mocked(fakePlayer.pause)).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().status).toBe('paused');
  });

  it('togglePlayPause resumes a paused track', async () => {
    stubFetchForPlay([track('itunes:1')]);
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
    stubFetchForPlay(tracks);
    await playerService.playQueue(tracks);
    emitStartedPlaying();

    await playerService.next();

    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(2);
  });

  it('a lock-screen next command advances the queue', async () => {
    const tracks = [track('itunes:1'), track('itunes:2')];
    stubFetchForPlay(tracks);
    await playerService.playQueue(tracks);
    emitStartedPlaying();

    commandListeners.forEach((l) => l('next'));
    await flush();

    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(2);
  });

  it('a lock-screen previous command goes back in the queue', async () => {
    const tracks = [track('itunes:1'), track('itunes:2')];
    stubFetchForPlay(tracks);
    await playerService.playQueue(tracks, 1);
    emitStartedPlaying();

    commandListeners.forEach((l) => l('previous'));
    await flush();

    expect(usePlayerStore.getState().currentIndex).toBe(0);
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(2);
  });

  it('previous clamps at the first track', async () => {
    const tracks = [track('itunes:1'), track('itunes:2')];
    stubFetchForPlay(tracks);
    await playerService.playQueue(tracks, 1);
    emitStartedPlaying();

    await playerService.previous();

    expect(usePlayerStore.getState().currentIndex).toBe(0);
    expect(vi.mocked(fakePlayer.load)).toHaveBeenCalledTimes(2);
  });

  it('seekTo updates the store and the native player', async () => {
    stubFetchForPlay([track('itunes:1')]);
    await playerService.playQueue([track('itunes:1')]);

    await playerService.seekTo(30000);

    expect(usePlayerProgressStore.getState().positionMs).toBe(30000);
    expect(vi.mocked(fakePlayer.seekTo)).toHaveBeenCalledWith(30000);
  });

  it('a failed stream resolve surfaces an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeResponse({ message: 'not found' }, 404))
    );

    await playerService.playTrack(track('itunes:1'));

    expect(usePlayerStore.getState().status).toBe('error');
    expect(usePlayerStore.getState().errorMessage).toBeTruthy();
    expect(vi.mocked(fakePlayer.load)).not.toHaveBeenCalled();
  });

  it('native errors surface into the store', async () => {
    playerService.initialize();
    errorListeners.forEach((l) => l('Player crashed'));

    expect(usePlayerStore.getState().status).toBe('error');
    expect(usePlayerStore.getState().errorMessage).toBe('Player crashed');
  });
});
