# Provider Architecture

## Core Principle

**Metadata discovery and playable/downloadable sources are separate concepts.** A track may get metadata from Provider A, lyrics from Provider B, and a playable source from Provider C. The application never assumes any single provider is the audio source. Providers are added or removed without changing core business logic.

## Provider Types

| Type     | Purpose                                                      | Examples                                                                                                                              |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Metadata | Search, browse, artist/album/track details                   | MusicBrainz, Last.fm, Deezer (metadata only), iTunes API                                                                              |
| Source   | Playable/downloadable audio the app is _permitted_ to access | Public domain archives (Internet Archive), Creative Commons sources, Jamendo, Free Music Archive, user-uploaded content (with rights) |
| Lyrics   | Synced + plain text lyrics                                   | LRCLIB (LRC), Genius (plain), Musixmatch (licensed)                                                                                   |

**Important boundary:** The system only resolves sources from services the application is legally permitted to access. It never extracts or downloads protected audio.

## Provider Interface

```typescript
// providers/types.ts
export interface MetadataProvider {
  readonly id: string; // 'musicbrainz' | 'lastfm' | ...
  readonly type: 'metadata';
  readonly capabilities: MetadataCapabilities;

  search(query: string, opts: SearchOpts): Promise<RawSearchResults>;
  getTrack(id: string): Promise<RawTrack | null>;
  getArtist(id: string): Promise<RawArtist | null>;
  getAlbum(id: string): Promise<RawAlbum | null>;
  getArtistTracks(artistId: string, opts: PageOpts): Promise<RawTrack[]>;
  getArtistAlbums(artistId: string, opts: PageOpts): Promise<RawAlbum[]>;
  getAlbumTracks(albumId: string, opts: PageOpts): Promise<RawTrack[]>;
  getRelatedArtists(artistId: string): Promise<RawArtist[]>;
  healthCheck(): Promise<HealthResult>;
}

export interface SourceProvider {
  readonly id: string;
  readonly type: 'source';
  readonly capabilities: SourceCapabilities;

  searchForTrack(track: CanonicalTrack, opts: ResolveOpts): Promise<SourceCandidate[]>;
  resolvePlayback(candidate: SourceCandidate): Promise<PlaybackSource>;
  resolveDownload(candidate: SourceCandidate, quality: Quality): Promise<DownloadSource>;
  healthCheck(): Promise<HealthResult>;
}

export interface LyricsProvider {
  readonly id: string;
  readonly type: 'lyrics';
  readonly capabilities: LyricsCapabilities;

  search(track: CanonicalTrack): Promise<LyricsCandidate[]>;
  fetchSynced(candidate: LyricsCandidate): Promise<SyncedLyrics>;
  fetchPlain(candidate: LyricsCandidate): Promise<PlainLyrics>;
  healthCheck(): Promise<HealthResult>;
}

export interface ProviderRegistry {
  getMetadata(): MetadataProvider[];
  getSources(): SourceProvider[];
  getLyrics(): LyricsProvider[];
  getMetadataById(id: string): MetadataProvider | undefined;
  getSourceById(id: string): SourceProvider | undefined;
  getLyricsById(id: string): LyricsProvider | undefined;
  isEnabled(id: string): boolean;
  setEnabled(id: string, enabled: boolean): void;
}
```

## Adapter Isolation

```
providers/
├── types.ts                    # Interfaces above
├── registry.ts                 # Dynamic registry with circuit breakers
├── metadata/
│   ├── musicbrainz/
│   │   ├── index.ts            # MusicBrainzMetadataProvider implements MetadataProvider
│   │   ├── http.ts             # Provider-specific HTTP client
│   │   ├── mapper.ts           # Raw response -> RawTrack/RawArtist/RawAlbum
│   │   └── config.ts           # Endpoints, rate-limit policy
│   ├── lastfm/
│   │   ├── index.ts
│   │   ├── http.ts
│   │   ├── mapper.ts
│   │   └── config.ts
│   └── ...
├── sources/
│   ├── internet-archive/       # Legal, public-domain audio source
│   │   ├── index.ts
│   │   ├── http.ts
│   │   ├── mapper.ts
│   │   └── config.ts
│   └── ...
└── lyrics/
    ├── lrclib/
    │   ├── index.ts
    │   ├── http.ts
    │   └── config.ts
    └── ...
```

**Rules:**

- A provider directory contains ALL code for that provider (no cross-provider imports)
- Each provider has its own HTTP client (timeouts, retries, rate limits)
- Each provider maps its raw responses to the shared Raw* models in `mapper.ts`
- No domain code (search scoring, dedup, recommendations) lives in provider directories
- No provider is imported directly by app services — always via registry + interfaces

## Canonical Model

All provider responses are normalized into a shared canonical model before entering domain logic.

```typescript
// domain/entities/track.ts
export interface CanonicalTrack {
  id: string; // App-generated ULID (stable internal id)
  title: string;
  artists: CanonicalArtist[];
  album?: CanonicalAlbum;
  durationMs: number;
  artworkUrl?: string;
  isrc?: string;
  releaseDate?: string;
  explicit?: boolean;
  version?: string; // 'Remix', 'Acoustic', 'Live'
  trackNumber?: number;
  discNumber?: number;
  providerIds: Record<string, string>; // { musicbrainz: 'abc', lastfm: 'def' }
  providerConfidence: number; // 0-1, computed during merge
}

export interface RawTrack {
  provider: string; // Which provider produced this
  providerId: string;
  title: string;
  artistNames: string[];
  albumTitle?: string;
  durationMs?: number;
  artworkUrl?: string;
  isrc?: string;
  releaseDate?: string;
  explicit?: boolean;
  version?: string;
  popularity?: number;
}
```

## Normalization & Matching

### Track Normalizer

```typescript
// domain/services/track-normalizer.ts
export class TrackNormalizer {
  // Title normalization
  normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .normalize('NFKD')                    // Unicode normalization
      .replace(/[\u0300-\u036f]/g, '')      // strip diacritics
      .replace(/[^\p{L}\p{N}]+/gu, ' ')     // collapse to word chars
      .trim()
      .replace(/\s+/g, ' ')
      // Strip version/featuring suffixes where appropriate
      .replace(/\s*\(.*\)\s*$/, '')         // "Song (Remix)" -> "Song"
      .replace(/\s*-\s*(remix|acoustic|live).*$/i, '');
  }

  normalizeArtist(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\b(and|&)\b/g, '&')         // "and" -> "&"
      .replace(/^the\s+/, '');               // "The Beatles" -> "Beatles" (sort key)
  }

  // Multi-word query normalization for search
  normalizeQuery(q: string): string { ... }

  // Build dedup fingerprint
  fingerprint(track: RawTrack): string {
    const title = this.normalizeTitle(track.title);
    const artists = track.artistNames.map(a => this.normalizeArtist(a)).sort().join('&');
    return `${title}|${artists}`;
  }
}
```

### Search Scorer

```typescript
// domain/services/search-scorer.ts
export interface ScoreBreakdown {
  total: number;              // 0-1
  titleScore: number;
  artistScore: number;
  albumScore: number;
  durationScore: number;
  isrcScore: number;
  versionScore: number;
  popularityScore: number;
  providerScore: number;
}

export class SearchScorer {
  // Weights (configurable)
  private weights = {
    title: 0.35,
    artist: 0.30,
    album: 0.10,
    duration: 0.05,
    isrc: 0.10,
    version: 0.05,
    popularity: 0.03,
    provider: 0.02,
  };

  score(query: NormalizedQuery, result: RawTrack): ScoreBreakdown {
    const titleScore = this.titleScore(query.title, result.title);
    const artistScore = this.artistScore(query.artist, result.artistNames);
    const albumScore = this.albumScore(query.album, result.albumTitle);
    const durationScore = this.durationScore(query.durationMs, result.durationMs);
    const isrcScore = query.isrc && result.isrc === query.isrc ? 1 : 0;
    const versionScore = this.versionMatch(query.version, result.version);
    const popularityScore = this.normalizePopularity(result.popularity);
    const providerScore = PROVIDER_CONFIDENCE[result.provider] ?? 0.5;

    return {
      total: weightedSum({...}),
      ...,
    };
  }

  titleScore(query: string, title: string): number {
    if (query === title) return 1.0;                 // exact
    if (title.includes(query)) return 0.9;           // substring
    if (query.includes(title)) return 0.7;           // query longer
    const dist = levenshtein(query, title);
    const maxLen = Math.max(query.length, title.length);
    return Math.max(0, 1 - dist / maxLen);           // fuzzy
  }
}
```

### Deduplicator

```typescript
// domain/services/deduplicator.ts
export class Deduplicator {
  deduplicate(results: RawTrack[]): CanonicalTrack[] {
    // Group by ISRC (strongest signal)
    const byIsrc = groupBy(results, (r) => r.isrc);
    // Group by normalized fingerprint
    const byFingerprint = groupBy(results, (r) => normalizer.fingerprint(r));

    // For each candidate group, select the best representative:
    // 1. Highest total metadata completeness
    // 2. Highest provider confidence
    // 3. Highest duration agreement with group median

    // Merge: keep all providerIds, prefer most complete fields
    // Provider agreement on duration: if |a - b| > tolerance, keep group
    //   with closer durations

    return canonicalTracks;
  }
}
```

### Duration Compatibility

```typescript
// Different providers report slightly different durations (intro/outro cuts)
function durationsCompatible(a: number | undefined, b: number | undefined): boolean {
  if (!a || !b) return true; // unknown is compatible
  const tolerance = Math.max(2000, Math.min(a, b) * 0.05); // 2s or 5%
  return Math.abs(a - b) <= tolerance;
}
```

## Source Resolver

```typescript
// domain/services/source-resolver.ts
export class SourceResolver {
  constructor(private registry: ProviderRegistry) {}

  async resolve(track: CanonicalTrack): Promise<ResolvedSource | null> {
    const candidates: ScoredSource[] = [];

    for (const provider of this.registry.getSources()) {
      if (!this.registry.isEnabled(provider.id)) continue;
      if (!provider.capabilities.resolvable) continue;

      try {
        const providerResults = await withTimeout(
          provider.searchForTrack(track, {
            isrc: track.isrc,
            title: track.title,
            artist: track.artistNames,
            durationMs: track.durationMs,
          }),
          5000,
        );
        for (const cand of providerResults) {
          candidates.push({
            ...cand,
            score: this.scoreSource(cand, track, provider.id),
          });
        }
      } catch (err) {
        logger.warn({ provider: provider.id, err }, 'source provider failed');
        this.registry.reportFailure(provider.id);
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // Never auto-select a low-confidence match
    if (!best || best.score < MIN_SOURCE_CONFIDENCE) {
      return null;
    }

    return {
      provider: best.providerId,
      type: best.type,
      url: best.url,
      format: best.format,
      durationMs: best.durationMs,
      confidence: best.score,
    };
  }

  scoreSource(candidate: SourceCandidate, track: CanonicalTrack, providerId: string): number {
    let score = 0;

    if (candidate.isrc && candidate.isrc === track.isrc)
      score += 60; // ISRC is gold
    else {
      if (normalizer.normalizeTitle(candidate.title) === normalizer.normalizeTitle(track.title))
        score += 20;
      else score += 5; // title mismatch heavily penalized
      if (durationsCompatible(candidate.durationMs, track.durationMs)) score += 15;
      if (artistNamesMatch(candidate.artistNames, track.artistNames)) score += 10;
    }
    if (candidate.licenseType === 'public_domain' || candidate.licenseType === 'cc') score += 5;
    if (candidate.sourceReliability) score += candidate.sourceReliability * 10; // 0-1

    // Provider historical reliability multiplier
    score *= PROVIDER_SOURCE_RELIABILITY[providerId] ?? 1.0;

    return score;
  }
}
```

## Lyrics Provider Abstraction

```typescript
// domain/services/lyric-matcher.ts
export class LyricMatcher {
  match(candidates: LyricsCandidate[], track: CanonicalTrack): LyricsResult | null {
    let best: LyricsCandidate | null = null;
    let bestScore = 0;

    for (const cand of candidates) {
      let score = 0;

      if (cand.isrc && cand.isrc === track.isrc) score += 50;

      const titleMatch = this.titleSimilarity(cand.title, track.title);
      score += titleMatch * 25;

      const artistMatch = this.artistMatch(cand.artistNames, track.artistNames);
      score += artistMatch * 20;

      if (durationsCompatible(cand.durationMs, track.durationMs)) score += 10;
      if (cand.version && track.version && cand.version === track.version) score += 5;
      else if (cand.version && track.version) score -= 10; // version conflict

      if (score > bestScore) {
        best = cand;
        bestScore = score;
      }
    }

    if (!best || bestScore < MIN_LYRICS_CONFIDENCE) return null;
    return mapCandidate(best, bestScore);
  }
}
```

Lyrics service flow:

```
Track metadata
    ↓
Check DB cache (trackId)  → hit: return
    ↓ miss
Query enabled lyrics providers in parallel (with timeout + circuit breaker)
    ↓
LyricMatcher picks best candidate (confidence threshold)
    ↓
Prefer synced lyrics; if only plain, return plain
    ↓
Cache result (24h match / 7d miss)
    ↓
Return
```

## Provider Registry & Health

```typescript
// providers/registry.ts
export class ProviderRegistryImpl implements ProviderRegistry {
  private metadata = new Map<string, MetadataProvider>();
  private sources = new Map<string, SourceProvider>();
  private lyrics = new Map<string, LyricsProvider>();
  private enabled = new Set<string>();
  private circuitStates = new Map<string, CircuitState>();

  getEnabledProviders<T>(map: Map<string, T>): T[] {
    return [...map.values()].filter((p) => this.enabled.has(p.id) && this.isCircuitClosed(p.id));
  }

  isCircuitClosed(id: string): boolean {
    const state = this.circuitStates.get(id);
    if (!state) return true;
    if (state.open) {
      if (Date.now() - state.openedAt > HALF_OPEN_DELAY_MS) {
        state.open = false; // half-open, allow trial request
        return true;
      }
      return false;
    }
    return true;
  }

  reportFailure(id: string): void {
    const state = this.circuitStates.get(id) ?? { failures: 0, open: false };
    state.failures += 1;
    if (state.failures >= CIRCUIT_OPEN_THRESHOLD) {
      state.open = true;
      state.openedAt = Date.now();
      logger.error({ provider: id }, 'circuit opened');
    }
    this.circuitStates.set(id, state);
  }

  reportSuccess(id: string): void {
    this.circuitStates.set(id, { failures: 0, open: false });
  }
}
```

Health metrics recorded in `provider_status` + `provider_events` tables for the admin dashboard.

## Adding a New Provider

1. Create directory `providers/<type>/<name>/`
2. Implement the appropriate interface (MetadataProvider / SourceProvider / LyricsProvider)
3. Write `mapper.ts` converting raw responses to shared Raw* models
4. Write `config.ts` (endpoints, API keys from env, rate limits, timeout)
5. Register in `registry.ts` (or via dynamic config/feature flag)
6. Add provider to `provider_status` (enabled flag default true)
7. Write unit tests for mapper + integration tests (against sandbox/staging endpoints)
8. Set confidence/reliability constants after observing real-world match rates

No core service changes required. New capabilities appear automatically in search, source resolution, and lyrics.

## Disabling a Broken Provider

- Admin can disable via `POST /admin/providers/:name/disable`
- Sets `provider_status.enabled = false`
- Registry `getEnabled*` excludes it immediately
- No code changes; app degrades gracefully (search still works, sources fall back)
- Circuit breaker auto-opens on repeated failures before admin intervenes

## Fallback Chain

```
Metadata search: MusicBrainz → Last.fm → [next enabled] → no result
Source resolve:  [enabled source providers, scored] → best ≥ threshold → none ("Source unavailable")
Lyrics:         LRCLIB → Genius → [next enabled] → plain-text fallback → "Lyrics aren't available"
```

User-facing errors are clean and never expose provider internals.

## Provider-Specific Identifiers

Stored separately in dedicated tables:

- `artists_external_ids`, `albums_external_ids`, `tracks_external_ids`

The canonical entity keeps its own stable internal ID. Provider IDs are reference data for matching and cross-referencing only.

## Cost Control

- Cache aggressively: search results, metadata, lyrics (with TTL)
- Parallel fan-out with short timeouts; don't wait for slow providers
- Rate limit provider calls server-side per provider policy
- Debounce repeated identical searches (dedupe within a window)
- Prefer free/open data sources (MusicBrainz, LRCLIB, Internet Archive, Jamendo) where legally usable
- Circuit breakers prevent wasted calls to broken providers
