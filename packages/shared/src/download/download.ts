/**
 * Download job model + explicit state machine.
 * Downloads are never modeled with booleans - every transition must be valid.
 */

export const DownloadStatus = {
  QUEUED: 'QUEUED',
  RESOLVING: 'RESOLVING',
  DOWNLOADING: 'DOWNLOADING',
  PROCESSING: 'PROCESSING',
  FETCHING_LYRICS: 'FETCHING_LYRICS',
  FINALIZING: 'FINALIZING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  PAUSED: 'PAUSED',
  EXPIRED: 'EXPIRED',
} as const;

export type DownloadStatus = (typeof DownloadStatus)[keyof typeof DownloadStatus];

export const DOWNLOAD_TRANSITIONS: Record<DownloadStatus, readonly DownloadStatus[]> = {
  QUEUED: ['RESOLVING', 'CANCELLED', 'FAILED', 'PAUSED'],
  RESOLVING: ['DOWNLOADING', 'FAILED', 'CANCELLED'],
  DOWNLOADING: ['PROCESSING', 'FAILED', 'CANCELLED', 'PAUSED'],
  PROCESSING: ['FETCHING_LYRICS', 'FINALIZING', 'FAILED'],
  FETCHING_LYRICS: ['FINALIZING', 'FAILED'],
  FINALIZING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['QUEUED', 'CANCELLED'],
  CANCELLED: [],
  PAUSED: ['QUEUED', 'CANCELLED'],
  EXPIRED: ['QUEUED'],
};

const TERMINAL: ReadonlySet<DownloadStatus> = new Set(['COMPLETED', 'CANCELLED']);

export class DownloadStateMachine {
  canTransition(from: DownloadStatus, to: DownloadStatus): boolean {
    if (TERMINAL.has(from)) return false;
    return DOWNLOAD_TRANSITIONS[from].includes(to);
  }

  /** Throws if the transition is invalid - never silently mutates. */
  transition(from: DownloadStatus, to: DownloadStatus): DownloadStatus {
    if (!this.canTransition(from, to)) {
      throw new Error(`Invalid download transition: ${from} -> ${to}`);
    }
    return to;
  }
}

export type DownloadQuality = 'low' | 'medium' | 'high' | 'lossless';

export interface DownloadJob {
  id: string;
  userId: string;
  trackId: string;
  status: DownloadStatus;
  progressPct: number;
  bytesDownloaded: number;
  bytesTotal?: number;
  speedBps?: number;
  retryCount: number;
  errorCode?: string;
  errorMessage?: string;
  sourceProvider?: string;
  sourceUrl?: string;
  objectKey?: string;
  fileFormat?: string;
  checksum?: string;
  quality: DownloadQuality;
  includeLyrics: boolean;
  includeSyncedLyrics: boolean;
  includeArtwork: boolean;
  priority: number;
  batchId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CreateDownloadInput {
  trackId: string;
  quality?: DownloadQuality;
  includeLyrics?: boolean;
  includeSyncedLyrics?: boolean;
  includeArtwork?: boolean;
  priority?: number;
}

export interface DownloadProgress {
  bytesDownloaded: number;
  bytesTotal: number;
  speedBps?: number;
}
