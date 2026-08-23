/**
 * Type contracts for the native (Kotlin) bridge modules that the Android
 * app must implement. These mirror the TurboModule-style surface of
 * `NativeModules.SincPlayer` and `NativeModules.SincDownloader`.
 */

export interface NativeProgressEvent {
  trackId: string;
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
}

/** Metadata attached to the native MediaItem so the notification shows the track. */
export interface NativeTrackMetadata {
  title?: string;
  artist?: string;
  artworkUrl?: string;
}

/** Commands issued by the lock-screen / notification media controls. */
export type NativePlayerCommand = 'next' | 'previous';

export interface NativePlayerModule {
  /** True when the native module is linked and usable. */
  available(): boolean;
  load(
    trackId: string,
    uri: string,
    mimeType?: string,
    headers?: Record<string, string>,
    metadata?: NativeTrackMetadata
  ): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(positionMs: number): Promise<void>;
  stop(): Promise<void>;
  getPosition(): Promise<number>;
  getDuration(): Promise<number>;
  isPlaying(): Promise<boolean>;
  /** Requests POST_NOTIFICATIONS at runtime (Android 13+); no-op elsewhere. */
  requestNotificationPermission(): Promise<void>;
  addProgressListener(listener: (event: NativeProgressEvent) => void): () => void;
  addCompletionListener(listener: (trackId: string) => void): () => void;
  addErrorListener(listener: (message: string) => void): () => void;
  addCommandListener(listener: (command: NativePlayerCommand) => void): () => void;
}

export interface NativeDownloadProgress {
  jobId: string;
  bytesDownloaded: number;
  bytesTotal: number;
}

export interface NativeDownloadResult {
  localUri: string;
  sizeBytes: number;
}

/** Track metadata written into the published Music/Sinc MediaStore entry. */
export interface NativeDownloadMetadata {
  title?: string;
  artist?: string;
  album?: string;
  /** Clean display name (song title only) for the published copy. */
  publicFileName?: string;
}

export interface NativeDownloaderModule {
  /** True when the native module is linked and usable. */
  available(): boolean;
  download(
    jobId: string,
    url: string,
    headers?: Record<string, string>,
    destinationFileName?: string,
    metadata?: NativeDownloadMetadata
  ): Promise<NativeDownloadResult>;
  cancel(jobId: string): Promise<void>;
  remove(jobId: string, fileName?: string): Promise<void>;
  getLocalUri(jobId: string): Promise<string | null>;
  addProgressListener(listener: (event: NativeDownloadProgress) => void): () => void;
}

export interface NativeBridge {
  player: NativePlayerModule;
  downloader: NativeDownloaderModule;
}
