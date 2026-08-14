import { DeviceEventEmitter, NativeModules } from 'react-native';

export type NativeDownloadState = 'unknown' | 'downloading' | 'completed' | 'failed';

export interface NativeDownloadStatus {
  state: NativeDownloadState;
  bytesDownloaded: number;
  bytesTotal: number;
  localUri?: string | null;
  errorCode?: string | null;
}

export interface NativeDownloadEvent extends NativeDownloadStatus {
  trackId: string;
}

export interface SincDownloadsNative {
  enqueueDownload(trackId: string, url: string, title: string): Promise<number>;
  cancelDownload(trackId: string): Promise<void>;
  queryProgress(trackId: string): Promise<NativeDownloadStatus>;
  getLocalUri(trackId: string): Promise<string | null>;
  deleteFile(trackId: string): Promise<boolean>;
  getFreeBytes(): Promise<number>;
  notifyBatchComplete(count: number): void;
}

const EVENT_NAME = 'SincDownloadEvent';

const native = NativeModules.SincDownloads as SincDownloadsNative | undefined;

/** True when the native module is missing (tests, web, old bundle). */
export function isDownloadsNativeAvailable(): boolean {
  return !!native && typeof native.enqueueDownload === 'function';
}

export const downloadsNative: SincDownloadsNative = {
  enqueueDownload: (trackId, url, title) =>
    native ? native.enqueueDownload(trackId, url, title) : Promise.resolve(-1),
  cancelDownload: (trackId) => (native ? native.cancelDownload(trackId) : Promise.resolve()),
  queryProgress: (trackId) =>
    native
      ? native.queryProgress(trackId)
      : Promise.resolve({ state: 'unknown', bytesDownloaded: 0, bytesTotal: 0 }),
  getLocalUri: (trackId) => (native ? native.getLocalUri(trackId) : Promise.resolve(null)),
  deleteFile: (trackId) => (native ? native.deleteFile(trackId) : Promise.resolve(false)),
  getFreeBytes: () => (native ? native.getFreeBytes() : Promise.resolve(Number.MAX_SAFE_INTEGER)),
  notifyBatchComplete: (count) => native?.notifyBatchComplete(count),
};

export function subscribeToDownloadEvents(
  handler: (event: NativeDownloadEvent) => void,
): () => void {
  const subscription = DeviceEventEmitter.addListener(EVENT_NAME, handler);
  return () => subscription.remove();
}
