import { NativeEventEmitter, NativeModules } from 'react-native';
import type {
  NativeBridge,
  NativeDownloadActionEvent,
  NativeDownloadActionsModule,
  NativeDownloaderModule,
  NativePlayerCommand,
  NativePlayerModule,
  NativeProgressEvent,
  NativeDownloadProgress,
  NativeHttpModule,
  NativeYtModule,
  NativeYtProgressEvent,
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
    remove: unavailable('downloader.remove'),
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
    requestNotificationPermission: () => module.requestNotificationPermission(),
    addProgressListener: (listener: (e: NativeProgressEvent) => void) => {
      const sub = emitter.addListener('SincPlayerProgress', listener);
      return () => sub.remove();
    },
    addCompletionListener: (listener: (trackId: string) => void) => {
      // Native emits { trackId }; unwrap to the string contract in types.ts.
      const sub = emitter.addListener('SincPlayerCompletion', (event: { trackId?: string }) =>
        listener(event?.trackId ?? '')
      );
      return () => sub.remove();
    },
    addErrorListener: (listener: (message: string) => void) => {
      // Native emits { message }; unwrap to the string contract in types.ts.
      const sub = emitter.addListener('SincPlayerError', (event: { message?: string }) =>
        listener(event?.message ?? 'Playback error')
      );
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
    download: (jobId, url, headers, destinationFileName, metadata, resumePart) =>
      module.download(
        jobId,
        url,
        headers ?? null,
        destinationFileName ?? null,
        metadata ?? null,
        Boolean(resumePart)
      ),
    remove: (jobId, fileName, publicFileName) =>
      module.remove(jobId, fileName ?? null, publicFileName ?? null),
    addProgressListener: (listener: (e: NativeDownloadProgress) => void) => {
      const sub = emitter.addListener('SincDownloadProgress', listener);
      return () => sub.remove();
    },
  };
}

function createUnavailableYt(): NativeYtModule {
  return {
    available: () => false,
    resolveStream: unavailable('yt.resolveStream'),
    resolveByQuery: unavailable('yt.resolveByQuery'),
    prefetch: unavailable('yt.prefetch'),
    download: unavailable('yt.download'),
    remove: unavailable('yt.remove'),
  };
}

function createYt(): NativeYtModule {
  const module = NativeModules.SincYt;
  if (!module) return createUnavailableYt();
  return {
    available: () => true,
    resolveStream: (url) => module.resolveStream(url),
    resolveByQuery: (artist, title, durationMs) =>
      module.resolveByQuery(artist, title, durationMs ?? 0),
    prefetch: (artist, title, durationMs) => module.prefetch(artist, title, durationMs ?? 0),
    download: (
      jobId: string,
      query: string,
      destinationFileName: string,
      expectedDurationMs: number | null,
      mediaUrl?: string | null,
      title?: string | null,
      resumePart?: boolean,
      artist?: string | null,
      album?: string | null,
      artworkUrl?: string | null,
      publicFileName?: string | null
    ) =>
      module.download(
        jobId,
        query,
        destinationFileName,
        expectedDurationMs ?? 0,
        mediaUrl ?? null,
        title ?? null,
        Boolean(resumePart),
        artist ?? null,
        album ?? null,
        artworkUrl ?? null,
        publicFileName ?? null
      ),
    // Older native builds lack `remove`; JS feature-detects before calling.
    remove:
      typeof module.remove === 'function'
        ? (fileName: string, publicFileName?: string) =>
            module.remove(fileName, publicFileName ?? null)
        : undefined,
  };
}

function createUnavailableDownloadActions(): NativeDownloadActionsModule {
  return {
    available: () => false,
    pause: unavailable('downloads.pause'),
    cancel: unavailable('downloads.cancel'),
    addActionListener: () => () => {},
    addYtProgressListener: () => () => {},
  };
}

function createDownloadActions(): NativeDownloadActionsModule {
  const module = NativeModules.SincDownloadActions;
  if (!module) return createUnavailableDownloadActions();
  const emitter = new NativeEventEmitter(module);
  return {
    available: () => true,
    pause: (jobId) => module.pause(jobId),
    cancel: (jobId) => module.cancel(jobId),
    addActionListener: (listener: (event: NativeDownloadActionEvent) => void) => {
      const sub = emitter.addListener('SincDownloadAction', listener);
      return () => sub.remove();
    },
    addYtProgressListener: (listener: (event: NativeYtProgressEvent) => void) => {
      const sub = emitter.addListener('SincYtProgress', listener);
      return () => sub.remove();
    },
  };
}

function createHttp(): NativeHttpModule {
  const module = NativeModules.SincHttp;
  if (!module) {
    return {
      available: () => false,
      get: unavailable('http.get'),
    };
  }
  return {
    available: () => true,
    get: (url, userAgent, accept) => module.get(url, userAgent, accept ?? null),
  };
}

/**
 * Access point for the native modules. Falls back to throwing stubs when the
 * native side is not linked, so JS code and tests can always import it safely.
 */
export const nativeBridge: NativeBridge = {
  player: createPlayer(),
  downloader: createDownloader(),
  yt: createYt(),
  downloads: createDownloadActions(),
  http: createHttp(),
};
