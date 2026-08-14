import {
  MUSICBRAINZ_BASE_URL,
  MUSICBRAINZ_RETRIES,
  MUSICBRAINZ_TIMEOUT_MS,
  MUSICBRAINZ_USER_AGENT,
} from './config.js';

export type ProviderFetch = typeof fetch;

export interface MusicBrainzHttpOptions {
  timeoutMs?: number;
  retries?: number;
}

export class MusicBrainzHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MusicBrainzHttpError';
  }
}

/** Minimal typed view of what the mapper needs from the JSON bodies. */
export interface MusicBrainzResponse {
  recordings?: unknown[];
  artists?: unknown[];
  'release-groups'?: unknown[];
  'release-group'?: unknown;
  release?: unknown;
  error?: string;
}

/**
 * Small HTTP client for the MusicBrainz ws/2 API: timeout via AbortSignal,
 * one retry on network/5xx/429 failures, MusicBrainz-required User-Agent.
 * The fetch implementation is injectable so tests can stub responses.
 */
export class MusicBrainzHttp {
  constructor(
    private readonly fetchFn: ProviderFetch = fetch,
    private readonly baseUrl: string = MUSICBRAINZ_BASE_URL,
    private readonly userAgent: string = MUSICBRAINZ_USER_AGENT,
  ) {}

  async get(path: string, opts: MusicBrainzHttpOptions = {}): Promise<MusicBrainzResponse> {
    const timeoutMs = opts.timeoutMs ?? MUSICBRAINZ_TIMEOUT_MS;
    const retries = opts.retries ?? MUSICBRAINZ_RETRIES;

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.request(path, timeoutMs);
      } catch (error) {
        lastError = error;
        if (!(error instanceof MusicBrainzHttpError) || !this.retryable(error)) break;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  private async request(path: string, timeoutMs: number): Promise<MusicBrainzResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new MusicBrainzHttpError(`HTTP ${response.status}`, response.status);
      }
      return (await response.json()) as MusicBrainzResponse;
    } catch (error) {
      if (error instanceof MusicBrainzHttpError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new MusicBrainzHttpError(`timeout after ${timeoutMs}ms`);
      }
      throw new MusicBrainzHttpError(`network error: ${String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private retryable(error: MusicBrainzHttpError): boolean {
    return error.status == null || error.status === 429 || error.status >= 500;
  }
}
