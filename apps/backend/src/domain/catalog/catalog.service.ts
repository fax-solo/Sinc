import {
  NotFoundError,
  ProviderError,
  type CanonicalAlbum,
  type CanonicalArtist,
  type CanonicalTrack,
  type SourceInfo,
  normalizeArtist,
  normalizeTitle,
} from '@sinc/shared';
import { Deduplicator } from './deduplicator.js';
import { toCanonicalAlbum, toCanonicalArtist } from './normalize.js';
import type { ProviderRegistry } from './registry.js';
import type { MetadataProvider } from './types.js';
import { SearchScorer, parseQuery, type ScoreBreakdown } from './search-scorer.js';

export interface ScoredTrack {
  track: CanonicalTrack;
  score: ScoreBreakdown;
}

export interface ProviderCallSummary {
  attempted: string[];
  succeeded: string[];
  failed: Array<{ provider: string; error: string }>;
}

export interface SearchResults {
  query: string;
  tracks: ScoredTrack[];
  artists: CanonicalArtist[];
  albums: CanonicalAlbum[];
  providers: ProviderCallSummary;
}

export interface CatalogSearchOptions {
  limit?: number;
  providerTimeoutMs?: number;
  /** Post-rank filter: track artist must contain this (normalized). */
  artist?: string;
  /** Post-rank filter: track album title must contain this (normalized). */
  album?: string;
  durationMin?: number;
  durationMax?: number;
}

export interface SearchSuggestion {
  type: 'song' | 'artist' | 'album';
  id: string;
  text: string;
  subtitle?: string;
  artworkUrl?: string;
  score: number;
}

export interface EntityDetailOptions {
  /** Pin the lookup to one provider id; otherwise every enabled provider is tried. */
  provider?: string;
  limit?: number;
  offset?: number;
  providerTimeoutMs?: number;
}

export interface TrackDetailResult {
  track: CanonicalTrack;
  providers: ProviderCallSummary;
}

export interface ArtistDetailResult {
  artist: CanonicalArtist;
  topTracks: CanonicalTrack[];
  albums: CanonicalAlbum[];
  relatedArtists: CanonicalArtist[];
  providers: ProviderCallSummary;
}

export interface AlbumDetailResult {
  album: CanonicalAlbum;
  tracks: CanonicalTrack[];
  providers: ProviderCallSummary;
}

export interface TrackSourcesResult {
  track: CanonicalTrack;
  sources: SourceInfo[];
  providers: ProviderCallSummary;
}

/**
 * Fan-out search across every enabled, circuit-closed metadata provider.
 * Providers that fail are skipped (graceful degradation); results are scored,
 * deduplicated and ranked by relevance before anything leaves the domain layer.
 */
export class CatalogService {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly scorer: SearchScorer = new SearchScorer(),
    private readonly deduplicator: Deduplicator = new Deduplicator(),
  ) {}

  async search(rawQuery: string, opts: CatalogSearchOptions = {}): Promise<SearchResults> {
    const query = parseQuery(rawQuery);
    const limit = opts.limit ?? 30;
    const timeoutMs = opts.providerTimeoutMs ?? 8_000;
    const providers = this.registry.getMetadata();

    const summary: ProviderCallSummary = { attempted: [], succeeded: [], failed: [] };
    const rawTracks: import('@sinc/shared').RawTrack[] = [];
    const rawArtists: import('@sinc/shared').RawArtist[] = [];
    const rawAlbums: import('@sinc/shared').RawAlbum[] = [];

    const results = await Promise.all(
      providers.map(async (provider) => {
        summary.attempted.push(provider.id);
        try {
          const result = await this.registry.call(
            provider.id,
            () => provider.search(rawQuery, { limit: Math.max(limit, 10) }),
            timeoutMs,
          );
          summary.succeeded.push(provider.id);
          return result;
        } catch (error) {
          summary.failed.push({ provider: provider.id, error: String(error) });
          return null;
        }
      }),
    );

    for (const result of results) {
      if (!result) continue;
      rawTracks.push(...result.tracks);
      rawArtists.push(...result.artists);
      rawAlbums.push(...result.albums);
    }

    const scored = rawTracks
      .map((raw) => ({ raw, breakdown: this.scorer.score(query, raw) }))
      .sort((a, b) => b.breakdown.total - a.breakdown.total);

    const merged = this.deduplicator.deduplicateDetailed(scored.map((s) => s.raw));
    const scoreByProviderId = new Map<string, ScoreBreakdown>();
    for (const entry of scored) {
      scoreByProviderId.set(`${entry.raw.provider}:${entry.raw.providerId}`, entry.breakdown);
    }
    const ranked = merged
      .sort((a, b) => {
        const sa =
          scoreByProviderId.get(`${a.representative.provider}:${a.representative.providerId}`)
            ?.total ?? 0;
        const sb =
          scoreByProviderId.get(`${b.representative.provider}:${b.representative.providerId}`)
            ?.total ?? 0;
        return sb - sa;
      })
      .map((entry) => ({
        track: entry.track,
        score:
          scoreByProviderId.get(
            `${entry.representative.provider}:${entry.representative.providerId}`,
          ) ?? new SearchScorer().score(query, entry.representative),
      }));

    const filtered = ranked.filter(({ track }) => this.matchesFilters(track, opts));
    const rankedFiltered = filtered.slice(0, limit);

    return {
      query: rawQuery,
      tracks: rankedFiltered,
      artists: dedupeArtists(rawArtists),
      albums: dedupeAlbums(rawAlbums),
      providers: summary,
    };
  }

  private matchesFilters(track: CanonicalTrack, opts: CatalogSearchOptions): boolean {
    if (opts.artist) {
      const needle = normalizeArtist(opts.artist);
      if (!track.artists.some((a) => normalizeArtist(a.name).includes(needle))) return false;
    }
    if (opts.album) {
      const needle = normalizeTitle(opts.album);
      if (!track.album || !normalizeTitle(track.album.title).includes(needle)) return false;
    }
    if (opts.durationMin != null && track.durationMs < opts.durationMin) return false;
    if (opts.durationMax != null && track.durationMs > opts.durationMax) return false;
    return true;
  }

  /**
   * Typeahead suggestions: reuses a small search and maps the best-scored
   * hits across types into flat suggestion entries, exact title/artist
   * matches first.
   */
  async suggest(rawQuery: string, limit = 8): Promise<SearchSuggestion[]> {
    const results = await this.search(rawQuery, { limit: Math.max(limit, 8) });
    const suggestions: SearchSuggestion[] = [];

    for (const { track, score } of results.tracks) {
      suggestions.push({
        type: 'song',
        id: track.id,
        text: track.title,
        subtitle: track.artists.map((a) => a.name).join(', '),
        artworkUrl: track.artworkUrl,
        score: score.total,
      });
    }
    for (const artist of results.artists) {
      suggestions.push({
        type: 'artist',
        id: artist.id,
        text: artist.name,
        subtitle: artist.genres.slice(0, 3).join(' · ') || undefined,
        artworkUrl: artist.artworkUrl,
        score: 0.9,
      });
    }
    for (const album of results.albums) {
      suggestions.push({
        type: 'album',
        id: album.id,
        text: album.title,
        subtitle: album.releaseYear ? String(album.releaseYear) : undefined,
        artworkUrl: album.artworkUrl,
        score: 0.8,
      });
    }

    const q = normalizeTitle(rawQuery);
    suggestions.sort((a, b) => {
      const aExact = normalizeTitle(a.text) === q ? 1 : 0;
      const bExact = normalizeTitle(b.text) === q ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return b.score - a.score;
    });

    return suggestions.slice(0, limit);
  }

  /**
   * Resolve one track by provider id. Every enabled provider is tried (in
   * registration order) unless `opts.provider` pins one. A pinned provider
   * that cannot serve the id yields 404; providers that error out are
   * reported in the summary and skipped.
   */
  async getTrackDetail(id: string, opts: EntityDetailOptions = {}): Promise<TrackDetailResult> {
    const providers = this.selectMetadataProviders(opts);
    const summary: ProviderCallSummary = { attempted: [], succeeded: [], failed: [] };
    const raw = await this.firstHit(
      providers,
      summary,
      (provider) => provider.getTrack(id),
      opts.providerTimeoutMs,
    );
    if (!raw) {
      this.throwWhenUnavailable(providers, summary);
      throw new NotFoundError('Track not found');
    }
    return { track: this.deduplicator.deduplicate([raw])[0]!, providers: finalizeSummary(summary) };
  }

  /** Artist profile + top tracks + albums + related artists in one pass. */
  async getArtistDetail(id: string, opts: EntityDetailOptions = {}): Promise<ArtistDetailResult> {
    const providers = this.selectMetadataProviders(opts);
    const summary: ProviderCallSummary = { attempted: [], succeeded: [], failed: [] };
    const timeoutMs = opts.providerTimeoutMs;

    const [raw, trackHits, albumHits, relatedHits] = await Promise.all([
      this.firstHit(providers, summary, (provider) => provider.getArtist(id), timeoutMs),
      this.fanOut(
        providers,
        summary,
        (provider) => provider.getArtistTracks(id, this.pageOpts(opts)),
        timeoutMs,
      ),
      this.fanOut(
        providers,
        summary,
        (provider) => provider.getArtistAlbums(id, this.pageOpts(opts)),
        timeoutMs,
      ),
      this.fanOut(providers, summary, (provider) => provider.getRelatedArtists(id), timeoutMs),
    ]);

    if (!raw) {
      this.throwWhenUnavailable(providers, summary);
      throw new NotFoundError('Artist not found');
    }

    const tracks = this.deduplicator.deduplicate(trackHits.flat());
    const albums = dedupeAlbums(albumHits.flat());
    const related = dedupeArtists(relatedHits.flat());

    return {
      artist: toCanonicalArtist(raw),
      topTracks: this.slice(tracks, opts),
      albums: this.slice(albums, opts),
      relatedArtists: this.slice(related, opts),
      providers: finalizeSummary(summary),
    };
  }

  /** Album profile + its track list. */
  async getAlbumDetail(id: string, opts: EntityDetailOptions = {}): Promise<AlbumDetailResult> {
    const providers = this.selectMetadataProviders(opts);
    const summary: ProviderCallSummary = { attempted: [], succeeded: [], failed: [] };

    const [raw, trackHits] = await Promise.all([
      this.firstHit(
        providers,
        summary,
        (provider) => provider.getAlbum(id),
        opts.providerTimeoutMs,
      ),
      this.fanOut(
        providers,
        summary,
        (provider) => provider.getAlbumTracks(id, this.pageOpts(opts)),
        opts.providerTimeoutMs,
      ),
    ]);

    if (!raw) {
      this.throwWhenUnavailable(providers, summary);
      throw new NotFoundError('Album not found');
    }

    const tracks = this.deduplicator.deduplicate(trackHits.flat());
    return {
      album: toCanonicalAlbum(raw),
      tracks: this.slice(tracks, opts),
      providers: finalizeSummary(summary),
    };
  }

  /**
   * Playlist detail. Playlists are user/system content persisted in the app
   * database (M3.2); no metadata provider serves them yet, so this always
   * yields 404 until that milestone lands.
   */
  async getPlaylistDetail(_id: string): Promise<never> {
    throw new NotFoundError('Playlists are not available yet');
  }

  /**
   * Source availability for a track: the track itself is resolved through
   * metadata providers, then every registered source provider reports what
   * it can stream/download. No source providers are registered until M2.6,
   * so `sources` is empty today.
   */
  async getTrackSources(id: string, opts: EntityDetailOptions = {}): Promise<TrackSourcesResult> {
    const detail = await this.getTrackDetail(id, opts);
    const providers = this.registry.getSource();
    const summary: ProviderCallSummary = { attempted: [], succeeded: [], failed: [] };
    const hits = await this.fanOut(
      providers,
      summary,
      (provider) => provider.checkAvailability(detail.track),
      opts.providerTimeoutMs,
    );
    return {
      track: detail.track,
      sources: hits.flat(),
      providers: finalizeSummary(mergeSummaries(detail.providers, summary)),
    };
  }

  private selectMetadataProviders(opts: EntityDetailOptions): MetadataProvider[] {
    if (opts.provider) {
      const pinned = this.registry.getMetadataById(opts.provider);
      if (!pinned) throw new NotFoundError(`Unknown provider "${opts.provider}"`);
      if (!this.registry.isEnabled(opts.provider)) {
        throw new ProviderError(opts.provider, `Provider "${opts.provider}" is disabled`);
      }
      return [pinned];
    }
    const providers = this.registry.getMetadata();
    if (providers.length === 0) {
      throw new ProviderError('metadata', 'No metadata provider is available');
    }
    return providers;
  }

  private pageOpts(opts: EntityDetailOptions): { limit: number; offset: number } {
    return { limit: opts.limit ?? 50, offset: opts.offset ?? 0 };
  }

  /** Every provider failed every call — surface the failure, not a 404. */
  private throwWhenUnavailable(
    providers: readonly { id: string }[],
    summary: ProviderCallSummary,
  ): void {
    if (providers.length === 0) return;
    const finalized = finalizeSummary(summary);
    if (finalized.failed.length === finalized.attempted.length) {
      const first = finalized.failed[0]!;
      throw new ProviderError(first.provider, first.error);
    }
  }

  private slice<T>(items: T[], opts: EntityDetailOptions): T[] {
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 50;
    return items.slice(offset, offset + limit);
  }

  /** Fan out one call over providers; null results and failures are skipped. */
  private async fanOut<P extends { id: string }, T>(
    providers: P[],
    summary: ProviderCallSummary,
    call: (provider: P) => Promise<T | null>,
    timeoutMs = 8_000,
  ): Promise<T[]> {
    const results = await Promise.all(
      providers.map(async (provider) => {
        summary.attempted.push(provider.id);
        try {
          const value = await this.registry.call(provider.id, () => call(provider), timeoutMs);
          if (value !== null) summary.succeeded.push(provider.id);
          return value ?? null;
        } catch (error) {
          summary.failed.push({ provider: provider.id, error: String(error) });
          return null;
        }
      }),
    );
    const hits: T[] = [];
    for (const result of results) {
      if (result !== null) hits.push(result);
    }
    return hits;
  }

  /** First non-null result in provider order (entity lookups). */
  private async firstHit<P extends { id: string }, T>(
    providers: P[],
    summary: ProviderCallSummary,
    call: (provider: P) => Promise<T | null>,
    timeoutMs?: number,
  ): Promise<T | null> {
    const hits = await this.fanOut(providers, summary, call, timeoutMs);
    return hits[0] ?? null;
  }
}

/** De-duplicate per-provider summary entries recorded by parallel fan-outs. */
function finalizeSummary(summary: ProviderCallSummary): ProviderCallSummary {
  const failed = new Map<string, string>();
  for (const entry of summary.failed) {
    if (!failed.has(entry.provider)) failed.set(entry.provider, entry.error);
  }
  return {
    attempted: [...new Set(summary.attempted)],
    succeeded: [...new Set(summary.succeeded)],
    failed: [...failed.entries()].map(([provider, error]) => ({ provider, error })),
  };
}

function mergeSummaries(a: ProviderCallSummary, b: ProviderCallSummary): ProviderCallSummary {
  return {
    attempted: [...a.attempted, ...b.attempted],
    succeeded: [...a.succeeded, ...b.succeeded],
    failed: [...a.failed, ...b.failed],
  };
}

/** Group artists by normalized name; prefer the most complete record. */
export function dedupeArtists(raw: readonly import('@sinc/shared').RawArtist[]): CanonicalArtist[] {
  const byName = new Map<string, import('@sinc/shared').RawArtist>();
  for (const artist of raw) {
    const key = normalizeArtist(artist.name);
    const existing = byName.get(key);
    if (!existing || completeness(artist) > completeness(existing)) byName.set(key, artist);
  }
  return [...byName.values()].map(toCanonicalArtist);
}

/** Group albums by normalized title + first artist; prefer the most complete. */
export function dedupeAlbums(raw: readonly import('@sinc/shared').RawAlbum[]): CanonicalAlbum[] {
  const byKey = new Map<string, import('@sinc/shared').RawAlbum>();
  for (const album of raw) {
    const key = `${normalizeTitle(album.title)}|${normalizeArtist(album.artistNames[0] ?? '')}`;
    const existing = byKey.get(key);
    if (!existing || completeness(album) > completeness(existing)) byKey.set(key, album);
  }
  return [...byKey.values()].map(toCanonicalAlbum);
}

function completeness(raw: {
  releaseDate?: string;
  artworkUrl?: string;
  totalTracks?: number;
  genres?: string[];
}): number {
  return [
    raw.releaseDate,
    raw.artworkUrl,
    raw.totalTracks != null ? 't' : '',
    (raw.genres ?? []).length > 0 ? 'g' : '',
  ].filter(Boolean).length;
}
