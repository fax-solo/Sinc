import { NativeEventEmitter, NativeModules } from 'react-native';
import type {
  NativeBridge,
  NativeDownloaderModule,
  NativePlayerCommand,
  NativePlayerModule,
  NativeProgressEvent,
  NativeDownloadProgress,
} from './types';

function unavailable(method: string): () => Promise<never> {
  return async () => {
    throw new Error(
      `Native module method "${method}" is unavailable. Link the Sinc native module.`
    );
  };
}

function createUnavailablePlayer(): NativePlayerModule {
  return {
    available: () => false,
    load: unavailable('player.load'),
    play: unavailable('player.play'),
    pause: unavailable('player.pause'),
    seekTo: unavailable('player.seekTo'),
    stop: unavailable('player.stop'),
    getPosition: unavailable('player.getPosition'),
    getDuration: unavailable('player.getDuration'),
    isPlaying: unavailable('player.isPlaying'),
    requestNotificationPermission: unavailable('player.requestNotificationPermission'),
    addProgressListener: () => () => {},
    addCompletionListener: () => () => {},
    addErrorListener: () => () => {},
    addCommandListener: () => () => {},
  };
}

function createUnavailableDownloader(): NativeDownloaderModule {
  return {
    available: () => false,
    download: unavailable('downloader.download'),
    cancel: unavailable('downloader.cancel'),
    remove: unavailable('downloader.remove'),
    getLocalUri: unavailable('downloader.getLocalUri'),
    addProgressListener: () => () => {},
  };
}

function createPlayer(): NativePlayerModule {
  const module = NativeModules.SincPlayer;
  if (!module) return createUnavailablePlayer();
  const emitter = new NativeEventEmitter(module);

  return {
    available: () => true,
    load: (trackId, uri, mimeType, headers, metadata) =>
      module.load(trackId, uri, mimeType ?? null, headers ?? null, metadata ?? null),
    play: () => module.play(),
    pause: () => module.pause(),
    seekTo: (positionMs) => module.seekTo(positionMs),
    stop: () => module.stop(),
    getPosition: () => module.getPosition(),
    getDuration: () => module.getDuration(),
    isPlaying: () => module.isPlaying(),
    requestNotificationPermission: () => module.requestNotificationPermission(),
    addProgressListener: (listener: (e: NativeProgressEvent) => void) => {
      const sub = emitter.addListener('SincPlayerProgress', listener);
      return () => sub.remove();
    },
    addCompletionListener: (listener: (trackId: string) => void) => {
      const sub = emitter.addListener('SincPlayerCompletion', listener);
      return () => sub.remove();
    },
    addErrorListener: (listener: (message: string) => void) => {
      const sub = emitter.addListener('SincPlayerError', listener);
      return () => sub.remove();
    },
    addCommandListener: (listener: (command: NativePlayerCommand) => void) => {
      const sub = emitter.addListener('SincPlayerCommand', (event: { command: string }) =>
        listener(event.command as NativePlayerCommand)
      );
      return () => sub.remove();
    },
  };
}

function createDownloader(): NativeDownloaderModule {
  const module = NativeModules.SincDownloader;
  if (!module) return createUnavailableDownloader();
  const emitter = new NativeEventEmitter(module);

  return {
    available: () => true,
    download: (jobId, url, headers, destinationFileName, metadata) =>
      module.download(jobId, url, headers ?? null, destinationFileName ?? null, metadata ?? null),
    cancel: (jobId) => module.cancel(jobId),
    remove: (jobId, fileName) => module.remove(jobId, fileName ?? null),
    getLocalUri: (jobId) => module.getLocalUri(jobId),
    addProgressListener: (listener: (e: NativeDownloadProgress) => void) => {
      const sub = emitter.addListener('SincDownloadProgress', listener);
      return () => sub.remove();
    },
  };
}

/**
 * Access point for the native modules. Falls back to throwing stubs when the
 * native side is not linked, so JS code and tests can always import it safely.
 */
export const nativeBridge: NativeBridge = {
  player: createPlayer(),
  downloader: createDownloader(),
};
