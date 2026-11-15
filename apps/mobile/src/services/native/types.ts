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
  albumTitle?: string;
  artworkUrl?: string;
  durationMs?: number;
  favorite?: boolean;
}

/** Commands issued by the lock-screen / notification media controls. */
export type NativePlayerCommand = 'next' | 'previous' | 'favorite';

export interface NativePlayerCommandEvent {
  command: NativePlayerCommand;
  trackId?: string;
}

/** Transport snapshot emitted by the service after native-side changes. */
export interface NativePlaybackState {
  trackId?: string | null;
  isPlaying: boolean;
  playbackState: 'idle' | 'buffering' | 'ready' | 'ended' | 'unknown';
  positionMs: number;
  durationMs: number;
  bufferedPositionMs?: number;
  favorite?: boolean;
  shuffle?: boolean;
  repeat?: 'off' | 'one' | 'all';
}

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
  /** Requests POST_NOTIFICATIONS at runtime (Android 13+); no-op elsewhere. */
  requestNotificationPermission(): Promise<void>;
  /** Current service-side transport snapshot for startup reconciliation. */
  getState(): Promise<NativePlaybackState>;
  /** JS library store is authoritative; native mirrors it for notification UI. */
  setFavorite(favorite: boolean): Promise<void>;
  addProgressListener(listener: (event: NativeProgressEvent) => void): () => void;
  addCompletionListener(listener: (trackId: string) => void): () => void;
  addErrorListener(listener: (message: string) => void): () => void;
  addStateListener(listener: (event: NativePlaybackState) => void): () => void;
  addCommandListener(listener: (event: NativePlayerCommandEvent) => void): () => void;
}

export interface NativeDownloadProgress {
  jobId: string;
  bytesDownloaded: number;
  /** 0 when the server did not send a length. */
  bytesTotal: number;
  /** True when the total size is unknown and no percentage is meaningful. */
  indeterminate?: boolean;
  /** Instantaneous transfer rate; 0/absent on the first sample. */
  speedBytesPerSec?: number | null;
}

export interface NativeDownloadResult {
  localUri: string;
  sizeBytes: number;
  /**
   * Real duration of the finished file (ms), probed natively via ffmpeg; 0
   * when the probe could not read it. JS validates this against the expected
   * track length before accepting a direct-source download.
   */
  durationMs?: number;
  /** Actual container MIME after native sniffing/tagging. */
  mimeType?: string;
  /** Actual published name after native container-extension correction. */
  publishedName?: string;
}

/** Track metadata written into the published Music/Sinc MediaStore entry. */
export interface NativeDownloadMetadata {
  title?: string;
  artist?: string;
  album?: string;
  /** Cover URL embedded by the native tagger (lossless remux). */
  artworkUrl?: string;
  /** Clean display name (song title only) for the published copy. */
  publicFileName?: string;
  /** Expected track duration (ms) so the probe result can be validated. */
  expectedDurationMs?: number;
  /** Trusted catalog preview used for content-level fingerprint verification. */
  previewUrl?: string;
}

export interface NativeDownloaderModule {
  /** True when the native module is linked and usable. */
  available(): boolean;
  download(
    jobId: string,
    url: string,
    headers?: Record<string, string>,
    destinationFileName?: string,
    metadata?: NativeDownloadMetadata,
    /** Continue from an existing `.part` via an HTTP Range request. */
    resumePart?: boolean
  ): Promise<NativeDownloadResult>;
  remove(jobId: string, fileName?: string, publicFileName?: string): Promise<void>;
  addProgressListener(listener: (event: NativeDownloadProgress) => void): () => void;
}

/** A freshly resolved stream URL from the yt-dlp module. */
export interface NativeYtStream {
  uri: string;
  ext: string;
  durationMs: number;
}

/** Result of a native yt-dlp download to app storage. */
export interface NativeYtDownload {
  localUri: string;
  durationMs: number;
  mimeType: string;
  /** Actual Music/Sinc display name (container-correct extension). Old builds omit it. */
  publishedName?: string;
}

/**
 * Contract for the on-device yt-dlp module (`NativeModules.SincYt`). Bundles a
 * static yt-dlp binary + ffmpeg and drives them with `--print`/download
 * invocations. Patterned on the server's `ytdlp.ts` so search/stream/download
 * logic stays identical between local and server builds.
 */
export interface NativeYtModule {
  /** True when the native module is linked and usable. */
  available(): boolean;
  /** Resolves the best direct stream url for a concrete webpage/media url. */
  resolveStream(url: string): Promise<NativeYtStream>;
  /** Finds the best match url for "artist - title" via site search. */
  resolveByQuery(artist: string, title: string, durationMs: number | null): Promise<string | null>;
  /** Warms the resolve caches for an upcoming track; true when it is cached now. */
  prefetch(artist: string, title: string, durationMs: number | null): Promise<boolean>;
  /** Drops a dead/revoked stream url from the native resolve caches (stale retry). */
  evictStream?(url: string): Promise<boolean>;
  /** Downloads the best match to app storage and returns the local file. */
  download(
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
    publicFileName?: string | null,
    /** Trusted catalog preview used for content-level fingerprint verification. */
    previewUrl?: string | null
  ): Promise<NativeYtDownload | null>;
  /** Deletes a finished download from the yt output dir; optional on old builds. */
  remove?(fileName: string, publicFileName?: string): Promise<void>;
}

/** Live progress for an engine (yt-dlp) download. */
export interface NativeYtProgressEvent {
  jobId: string;
  /** Absent when the total size is unknown (indeterminate). */
  percent?: number | null;
  /** True when no percentage is meaningful (unknown total size). */
  indeterminate?: boolean;
  bytesDownloaded?: number;
  bytesTotal?: number;
  /** Raw yt-dlp rate token, e.g. "214.55KiB/s". Absent when unknown. */
  speed?: string | null;
}

/** A download action triggered from the notification (or native side). */
export interface NativeDownloadActionEvent {
  jobId: string;
  action: 'paused' | 'cancelled' | 'resume' | 'transfer';
}

/** Work that happens after the byte transfer but before completion. */
export type NativeDownloadStage = 'processing' | 'tagging' | 'validating';

export interface NativeDownloadStageEvent {
  jobId: string;
  stage: NativeDownloadStage;
}

/** Bridge to pause / cancel running downloads from JS. */
export interface NativeDownloadActionsModule {
  available(): boolean;
  pause(jobId: string): Promise<void>;
  cancel(jobId: string): Promise<void>;
  addActionListener(listener: (event: NativeDownloadActionEvent) => void): () => void;
  addYtProgressListener(listener: (event: NativeYtProgressEvent) => void): () => void;
  addStageListener(listener: (event: NativeDownloadStageEvent) => void): () => void;
}

/** Raw result of a provider GET performed by the native HTTP bridge. */
export interface NativeHttpResult {
  status: number;
  body: string;
  contentType?: string | null;
}

/**
 * Contract for `NativeModules.SincHttp`. React Native's Android networking
 * forces a `User-Agent: okhttp/4.x` that Cloudflare-fronted providers (LRCLIB)
 * reject with HTTP 520, so provider lookups go through this bridge instead.
 */
export interface NativeHttpModule {
  /** True when the native module is linked and usable. */
  available(): boolean;
  get(
    url: string,
    userAgent: string,
    accept?: string | null,
    timeoutMs?: number
  ): Promise<NativeHttpResult>;
}

export interface BackupSaveResult {
  success: boolean;
  path: string;
  timestamp: number;
  sizeBytes: number;
}

export interface BackupReadResult {
  exists: boolean;
  data?: string;
  path?: string;
  timestamp?: number;
  sizeBytes?: number;
}

export interface ScannedAudioFile {
  fileName: string;
  uri: string;
  sizeBytes: number;
  lastModified: number;
}

export interface StorageStatsResult {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  sincBytes: number;
  songCount: number;
}

export interface CacheClearResult {
  success: boolean;
  freedBytes: number;
}

export interface NativeBackupModule {
  available(): boolean;
  saveBackup(jsonString: string): Promise<BackupSaveResult>;
  readBackup(): Promise<BackupReadResult>;
  scanDownloadedFiles(): Promise<ScannedAudioFile[]>;
  getStorageStats(): Promise<StorageStatsResult>;
  clearDownloadCache(): Promise<CacheClearResult>;
}

export interface NativeBridge {
  player: NativePlayerModule;
  downloader: NativeDownloaderModule;
  yt: NativeYtModule;
  downloads: NativeDownloadActionsModule;
  http: NativeHttpModule;
  audioOutput: NativeAudioOutputModule;
  backup: NativeBackupModule;
}

/** One physical output (speaker, headphones, Bluetooth…) visible to Android. */
export interface AudioOutputDevice {
  /** Stable while the device stays connected; pass back to setOutput. */
  id: number;
  name: string;
  productName?: string;
  isCurrent: boolean;
}

export interface NativeAudioOutputModule {
  /** True when the native module is linked and usable. */
  available(): boolean;
  /** Lists output routes; the active route is flagged. */
  getOutputs(): Promise<AudioOutputDevice[]>;
  /**
   * Routes playback to the given device id; a negative id restores the OS
   * default. Resolves false when there is no running playback session.
   */
  setOutput(deviceId: number): Promise<boolean>;
}
