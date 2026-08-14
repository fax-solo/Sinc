/**
 * Playable/downloadable source model. Sources are intentionally separate from
 * metadata: a track may have metadata from provider A and a source from
 * provider B. Only legally-permitted sources are ever resolved.
 */
import type { CanonicalTrack } from './index.js';

export type SourceType = 'stream' | 'download' | 'local';
export type LicenseType = 'permitted' | 'public_domain' | 'cc' | 'user_uploaded';

export interface SourceCandidate {
  provider: string;
  externalId: string;
  title: string;
  artistNames: string[];
  durationMs?: number;
  isrc?: string;
  url?: string;
  format?: string;
  bitrate?: number;
  licenseType?: LicenseType;
  /** 0-1 provider historical reliability, from health tracking. */
  sourceReliability?: number;
  /** Present when the candidate has already been scored by the resolver. */
  score?: number;
}

/** The chosen, best permitted source for a track. */
export interface ResolvedSource {
  provider: string;
  type: SourceType;
  url: string;
  format?: string;
  durationMs?: number;
  confidence: number;
  headers?: Record<string, string>;
  expiresAt?: number;
}

export interface SourceInfo {
  provider: string;
  type: SourceType;
  url?: string;
  format?: string;
  quality?: string;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  licenseType?: LicenseType;
}

export interface PlaybackSource {
  type: 'local' | 'remote' | 'cached';
  uri: string;
  headers?: Record<string, string>;
  mimeType?: string;
  trackId: string;
}

/** Result of resolving a track to one playable, permitted source. */
export interface PlaybackResolveResult {
  track: CanonicalTrack;
  source: PlaybackSource;
  /** 0-1 resolver confidence; sources below the threshold are never returned. */
  confidence: number;
  /** Unix ms when the signed source URL stops being valid. */
  expiresAt: number;
}

export interface DownloadSource {
  provider: string;
  url: string;
  format: string;
  quality: 'low' | 'medium' | 'high' | 'lossless';
  expectedBytes?: number;
  headers?: Record<string, string>;
  expiresAt?: number;
}
