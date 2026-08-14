import {
  NotFoundError,
  ProviderError,
  type CanonicalTrack,
  type PlaybackResolveResult,
  type SourceCandidate,
} from '@sinc/shared';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { ProviderRegistry } from '../catalog/registry.js';
import type { SourceProvider } from '../catalog/types.js';
import { SourceResolverService } from './source-resolver.service.js';
import { StreamSigner } from './stream-signer.js';

export interface PlaybackServiceOptions {
  catalog: CatalogService;
  registry: ProviderRegistry;
  resolver: SourceResolverService;
  signer: StreamSigner;
  /** Base URL for signed stream redirects (no trailing slash), e.g. http://localhost:4000/api/v1. */
  publicBaseUrl: string;
}

const SOURCE_TIMEOUT_MS = 8_000;

/**
 * Resolves a canonical track to exactly one playable source, then signs a
 * short-lived stream URL. Degradation: metadata errors surface as-is; a
 * track with no confident source yields 404; all source providers failing
 * yields 502 (never a silent auto-pick of a low-confidence source).
 */
export class PlaybackService {
  constructor(private readonly options: PlaybackServiceOptions) {}

  async resolveTrack(
    id: string,
    opts: { provider?: string; limit?: number; offset?: number } = {},
  ): Promise<PlaybackResolveResult> {
    const detail = await this.options.catalog.getTrackDetail(id, {
      provider: opts.provider,
      limit: opts.limit,
      offset: opts.offset,
    });
    const track = detail.track;

    const providers = this.options.registry.getSource();
    if (providers.length === 0) {
      throw new NotFoundError('No playable source is available for this track');
    }

    const candidates = await this.fanOut(providers, track);
    if (candidates.length === 0) {
      throw new NotFoundError('No playable source is available for this track');
    }

    const resolved = this.options.resolver.resolve(track, candidates);
    if (!resolved || !resolved.url) {
      throw new NotFoundError('No playable source is available for this track');
    }

    const signed = this.options.signer.sign(resolved.url);
    const streamUrl = `${this.options.publicBaseUrl}/playback/stream?url=${encodeURIComponent(
      signed.url,
    )}&exp=${signed.expiresAt}&sig=${signed.signature}`;

    return {
      track,
      source: {
        type: 'remote',
        uri: streamUrl,
        mimeType: mimeTypeFor(resolved.format),
        trackId: track.id,
      },
      confidence: resolved.confidence,
      expiresAt: signed.expiresAt,
    };
  }

  /** Fan out over source providers via the registry (circuit-broken calls). */
  private async fanOut(
    providers: readonly SourceProvider[],
    track: CanonicalTrack,
  ): Promise<SourceCandidate[]> {
    const results = await Promise.all(
      providers.map(async (provider) => {
        try {
          const candidates = await this.options.registry.call(
            provider.id,
            () => provider.resolveSources(track),
            SOURCE_TIMEOUT_MS,
          );
          return Array.isArray(candidates) ? candidates : null;
        } catch {
          return null;
        }
      }),
    );

    const hits = results.filter((r): r is SourceCandidate[] => r !== null).flat();
    const succeeded = providers.filter((_, i) => results[i] !== null).length;
    if (providers.length > 0 && succeeded === 0) {
      throw new ProviderError('source', 'All source providers failed');
    }
    return hits;
  }
}

function mimeTypeFor(format: string | undefined): string | undefined {
  if (!format) return undefined;
  const byExt: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    flac: 'audio/flac',
    wav: 'audio/wav',
  };
  const ext = format.split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
  return byExt[ext] ?? `audio/${ext}`;
}
