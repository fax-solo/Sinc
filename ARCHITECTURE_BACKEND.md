# Backend Architecture

## Overview

The backend is a modular Node.js/TypeScript service using a layered architecture. It exposes a versioned REST API plus WebSocket for realtime events, processes background jobs via a queue system, and integrates external music providers through isolated adapters.

## High-Level Backend Structure

```
┌──────────────────────────────────────────────────────────────┐
│                       API GATEWAY                            │
│  Fastify HTTP Server /api/v1/*                               │
│  ├── Request ID & Correlation ID middleware                  │
│  ├── Rate Limiting (per-user, per-IP, per-endpoint)          │
│  ├── Request Validation (Zod schemas)                        │
│  ├── Authentication (JWT access token verification)          │
│  ├── Authorization (RBAC permission checks)                  │
│  └── Error handling & response envelope                     │
├──────────────────────────────────────────────────────────────┤
│                      WEBHOOK / WS                           │
│  Socket.io server (rooms: user:{id}, admin)                  │
│  Push notification dispatch (FCM/APNs)                      │
├──────────────────────────────────────────────────────────────┤
│                  APPLICATION SERVICES                        │
│  AuthService, UserService, MusicService, PlaylistService,    │
│  FavoriteService, HistoryService, RecommendationService,     │
│  DownloadService, LyricsService, NotificationService,        │
│  SettingsService, AdminService, FeatureFlagService           │
├──────────────────────────────────────────────────────────────┤
│                     DOMAIN SERVICES                          │
│  SearchScorer, SourceResolver, RecommendationEngine,         │
│  LyricMatcher, TrackNormalizer, Deduplicator,                │
│  DownloadStateMachine, ConflictResolver                      │
├──────────────────────────────────────────────────────────────┤
│                     PROVIDER ADAPTERS                        │
│  Metadata providers  |  Source providers  |  Lyrics providers│
│  Each isolated in providers/<name>/, registered dynamically  │
├──────────────────────────────────────────────────────────────┤
│                      WORKERS                                 │
│  download.worker, lyrics.worker, recommendation.worker,      │
│  notification.worker, sync.worker, cleanup.worker            │
├──────────────────────────────────────────────────────────────┤
│                    INFRASTRUCTURE                            │
│  PostgreSQL (Prisma)  |  Redis (cache + queues + pubsub)     │
│  Object storage (S3/MinIO)  |  BullMQ queues                 │
└──────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
backend/
├── src/
│   ├── main.ts                    # Entry point
│   ├── server.ts                  # HTTP server setup
│   ├── config/
│   │   ├── env.ts                 # Environment validation
│   │   ├── redis.ts               # Redis client
│   │   ├── db.ts                  # Prisma client
│   │   ├── queue.ts               # BullMQ setup
│   │   ├── storage.ts             # Object storage client
│   │   └── logging.ts             # Pino logger setup
│   ├── api/
│   │   ├── routes/                # Route definitions
│   │   │   ├── auth.ts
│   │   │   ├── users.ts
│   │   │   ├── music.ts
│   │   │   ├── playlists.ts
│   │   │   ├── favorites.ts
│   │   │   ├── history.ts
│   │   │   ├── recommendations.ts
│   │   │   ├── downloads.ts
│   │   │   ├── lyrics.ts
│   │   │   ├── notifications.ts
│   │   │   ├── settings.ts
│   │   │   ├── storage.ts
│   │   │   ├── admin/
│   │   │   │   ├── dashboard.ts
│   │   │   │   ├── users.ts
│   │   │   │   ├── roles.ts
│   │   │   │   ├── providers.ts
│   │   │   │   ├── logs.ts
│   │   │   │   └── health.ts
│   │   │   └── health.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts            # JWT verification
│   │   │   ├── rbac.ts            # Role checks
│   │   │   ├── validation.ts      # Zod validation
│   │   │   ├── rateLimit.ts       # Sliding window rate limit
│   │   │   ├── errorHandler.ts    # Central error handling
│   │   │   ├── requestId.ts       # Request ID generation
│   │   │   └── audit.ts           # Admin audit logging
│   │   └── schemas/               # Zod schemas (shared with app)
│   ├── app/                       # Application services (use cases)
│   │   ├── auth.service.ts
│   │   ├── user.service.ts
│   │   ├── music.service.ts
│   │   ├── playlist.service.ts
│   │   ├── favorite.service.ts
│   │   ├── history.service.ts
│   │   ├── recommendation.service.ts
│   │   ├── download.service.ts
│   │   ├── lyrics.service.ts
│   │   ├── notification.service.ts
│   │   ├── settings.service.ts
│   │   ├── admin.service.ts
│   │   └── featureFlag.service.ts
│   ├── domain/
│   │   ├── entities/              # Domain entities
│   │   │   ├── track.ts
│   │   │   ├── artist.ts
│   │   │   ├── album.ts
│   │   │   ├── playlist.ts
│   │   │   ├── user.ts
│   │   │   ├── download.ts
│   │   │   ├── lyrics.ts
│   │   │   └── notification.ts
│   │   ├── services/              # Pure domain logic
│   │   │   ├── search-scorer.ts
│   │   │   ├── track-normalizer.ts
│   │   │   ├── source-resolver.ts
│   │   │   ├── recommendation-engine.ts
│   │   │   ├── lyric-matcher.ts
│   │   │   ├── download-state-machine.ts
│   │   │   └── conflict-resolver.ts
│   │   └── events/                # Domain events
│   │       ├── events.ts
│   │       └── event-bus.ts
│   ├── providers/
│   │   ├── types.ts               # Provider interfaces
│   │   ├── registry.ts            # Dynamic provider registry
│   │   ├── metadata/
│   │   │   ├── musicbrainz/       # Example metadata provider
│   │   │   └── lastfm/            # Example metadata provider
│   │   ├── sources/
│   │   │   └── example-source/    # Example legal source provider
│   │   └── lyrics/
│   │       ├── lrclib/            # LRC synced lyrics
│   │       └── musixmatch/        # Sync + plain lyrics (if licensed)
│   ├── workers/
│   │   ├── download.worker.ts
│   │   ├── lyrics.worker.ts
│   │   ├── recommendation.worker.ts
│   │   ├── notification.worker.ts
│   │   ├── sync.worker.ts
│   │   └── cleanup.worker.ts
│   ├── realtime/
│   │   ├── index.ts               # Socket.io setup
│   │   ├── events.ts              # Realtime event definitions
│   │   └── handlers.ts            # Socket event handlers
│   ├── infra/
│   │   ├── repositories/          # Prisma-backed repositories
│   │   ├── cache/                 # Redis cache helpers
│   │   ├── storage/               # Object storage helpers
│   │   └── notifications/         # FCM/APNs senders
│   └── utils/
│       ├── logger.ts
│       ├── errors.ts              # Typed error classes
│       ├── sanitize.ts
│       └── id.ts                  # ID generation (ULID)
├── prisma/
│   ├── schema.prisma              # Database schema
│   └── migrations/                # Migration files
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
├── docker/
│   ├── dev/
│   ├── staging/
│   └── prod/
├── .env.example
├── package.json
├── tsconfig.json
└── Dockerfile
```

## API Gateway

### Fastify Configuration

```typescript
// server.ts
import Fastify from 'fastify';
import { pinoLogger } from './config/logging';
import { routes } from './api/routes';
import { errorHandler } from './api/middleware/errorHandler';

export function buildServer() {
  const app = Fastify({
    logger: pinoLogger,
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024, // 10MB
  });

  // Register plugins
  app.register(corsPlugin);
  app.register(helmetPlugin);
  app.register(rateLimitPlugin);
  app.register(requestIdPlugin);

  // Register middleware
  app.decorateRequest('userId', null);
  app.decorateRequest('userRole', null);

  // Register routes
  app.register(routes, { prefix: '/api/v1' });

  // Error handling
  app.setErrorHandler(errorHandler);

  // Graceful shutdown
  app.addHook('onClose', async () => {
    await closeRedis();
    await closeQueue();
  });

  return app;
}
```

### Response Envelope

```typescript
// Standard success response
interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    hasNext?: boolean;
  };
  requestId: string;
  serverTime: string; // ISO 8601 UTC
}

// Standard error response
interface ApiErrorResponse {
  success: false;
  error: {
    code: string; // Machine-readable error code
    message: string; // Human-readable message
    details?: unknown; // Validation details
  };
  requestId: string;
  serverTime: string;
}

// Error codes
type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'PROVIDER_ERROR'
  | 'SOURCE_UNAVAILABLE'
  | 'DOWNLOAD_IN_PROGRESS'
  | 'STORAGE_FULL'
  | 'ACCOUNT_SUSPENDED'
  | 'EMAIL_NOT_VERIFIED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED';
```

## Application Services

### AuthService

```typescript
// app/auth.service.ts
export class AuthService {
  async register(data: RegisterInput): Promise<AuthResult> {
    // Validate input
    // Check email not already registered
    // Hash password (argon2id)
    // Create user with role USER
    // Create verification token
    // Send verification email
    // Return short-lived access token + refresh token
  }

  async login(data: LoginInput): Promise<AuthResult> {
    // Find user by email
    // Verify password
    // Check email verified
    // Check account not suspended
    // Create session (device record)
    // Issue tokens
    // Record audit event
  }

  async refresh(refreshToken: string, deviceId: string): Promise<TokenPair> {
    // Verify refresh token signature
    // Check token not revoked (Redis blacklist)
    // Check session still valid
    // Rotate refresh token
    // Issue new token pair
  }

  async logout(accessToken: string, refreshToken: string): Promise<void> {
    // Revoke refresh token (Redis)
    // Blacklist access token until expiry (Redis)
    // Remove session
  }

  async verifyEmail(token: string): Promise<void> {
    // Verify token
    // Mark email verified
    // Issue tokens
  }

  async requestPasswordReset(email: string): Promise<void> {
    // Generate reset token (single-use, short expiry)
    // Send email
    // Rate limit per user
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    // Verify token
    // Validate password strength
    // Update password hash
    // Revoke all sessions
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    // Used for sensitive actions (account deletion, security settings)
  }
}
```

### MusicService

```typescript
// app/music.service.ts
export class MusicService {
  async search(query: string, filters: SearchFilters): Promise<SearchResults> {
    // Normalize query
    // Fan out to enabled metadata providers (parallel)
    // Merge results into canonical tracks
    // Deduplicate & score
    // Apply filters
    // Rank & paginate
    // Cache popular queries
    // Return grouped results (tracks, artists, albums, playlists)
  }

  async getTrack(id: string): Promise<TrackDetail> {
    // Load from cache or DB
    // Enrich with provider data
    // Get download/playback availability
    // Get user-specific state (favorite, download status)
  }

  async getArtist(id: string): Promise<ArtistDetail> {
    // Load artist + albums + top tracks
    // Normalize across providers
  }

  async getAlbum(id: string): Promise<AlbumDetail> {
    // Load album + track list
    // Compute total duration
  }

  async getPlaylist(id: string, userId?: string): Promise<PlaylistDetail> {
    // Load playlist + tracks (paginated)
    // Check ownership/collaborator
  }

  async getTrackSources(id: string): Promise<TrackSourceInfo> {
    // Query source providers
    // Return availability + best source
    // Never expose raw provider secrets
  }
}
```

### DownloadService

```typescript
// app/download.service.ts
export class DownloadService {
  async createDownload(userId: string, request: CreateDownloadInput): Promise<DownloadJob> {
    // Check user quota/limits
    // Check duplicate (track already downloaded)
    // Create download_job record (QUEUED)
    // Enqueue job in BullMQ
    // Emit realtime event
  }

  async createBatchDownload(
    userId: string,
    request: CreateBatchDownloadInput,
  ): Promise<BatchDownload> {
    // For playlists/albums
    // Create batch record
    // Create individual jobs
    // Return aggregate progress endpoint
  }

  async getJob(userId: string, jobId: string): Promise<DownloadJob> {
    // Return job status
    // Enrich with track metadata
  }

  async listJobs(userId: string, filters: JobFilters): Promise<DownloadJob[]> {
    // Filter by status, date range
    // Paginate
  }

  async cancel(userId: string, jobId: string): Promise<void> {
    // If active, signal worker to stop
    // Mark CANCELLED
    // Notify user
  }

  async getSignedUrl(userId: string, jobId: string): Promise<string> {
    // Verify job belongs to user
    // Verify COMPLETED
    // Generate short-lived signed URL for object storage
    // Returns URL the mobile client uses to download
  }
}
```

### LyricsService

```typescript
// app/lyrics.service.ts
export class LyricsService {
  async getLyrics(userId: string, trackId: string): Promise<LyricsResult> {
    // Check DB cache first
    // If miss: gather track metadata
    // Query lyrics providers in parallel
    // Match using LyricMatcher
    // Prefer synced; fall back to plain
    // Cache result (24h for matches, 7d for misses)
    // Return to client
  }
}
```

### RecommendationService

```typescript
// app/recommendation.service.ts
export class RecommendationService {
  async getForYou(userId: string, options: PageOptions): Promise<RecommendationResult> {
    // Load user's listening profile (recent plays, favorites, skips, completion)
    // Compute candidate pools:
    //   70% familiar (played/favorited artists, genres, albums)
    //   20% similar (artists similar to favorites)
    //   10% discovery (unfamiliar, low-risk picks)
    // Score each candidate
    // De-duplicate against recent history
    // Apply hard filters (explicit setting, region availability)
    // Cache per user (short TTL)
    // Return shuffled, paginated results
  }

  async getQuickMixes(userId: string): Promise<QuickMix[]> {
    // Favorites Mix: top favorited + high-completion tracks
    // Chill Mix: low-energy genre pool + favorites
    // Recently Played Mix: last 50 unique tracks
    // Discovery Mix: 10% discovery pool
    // Artist Mix: top artist discography subset
    // Genre Mix: dominant genre pool
  }
}
```

## Domain Services

### TrackNormalizer

```typescript
// domain/services/track-normalizer.ts
export class TrackNormalizer {
  // Normalize title
  // - Strip featured artist suffix ("ft. X", "feat. X", "with X")
  // - Remove parenthetical version labels
  // - Lowercase, trim, collapse whitespace
  // - Normalize unicode (NFKD)
  // - Strip diacritics
  // - Remove punctuation
  normalizeTitle(title: string): string;

  // Normalize artist name
  // - Trim, collapse whitespace
  // - Normalize "&" vs "and"
  // - Handle "The" prefix ordering
  normalizeArtist(name: string): string;

  // Normalize album title (similar to title)
  normalizeAlbum(title: string): string;

  // Build a canonical fingerprint for dedup
  // Combination of normalized title + sorted normalized artists
  fingerprint(track: RawTrack): string;
}

export class SearchScorer {
  // Score a result for a query
  score(query: string, result: CandidateResult): ScoreBreakdown;

  // Sub-scores
  titleScore: number; // Levenshtein / substring / prefix match on title
  artistScore: number; // Artist match strength
  albumScore: number;
  durationScore: number; // Inverse of |providerDur - canonicalDur|
  isrcScore: number; // 1.0 if ISRC matches query track
  versionScore: number; // Penalize mismatched version labels
  popularityScore: number;
  providerScore: number; // Per-provider confidence multiplier
}

export class Deduplicator {
  // Group candidates by fingerprint (normalized)
  // Within groups: score provider agreement
  // Merge metadata (prefer most-complete / highest-confidence)
  // Preserve provider IDs for each source
  deduplicate(candidates: CandidateResult[]): CanonicalTrack[];
}
```

### SourceResolver

```typescript
// domain/services/source-resolver.ts
export class SourceResolver {
  // Input: canonical track metadata
  // Output: best permitted source, or none
  resolve(track: CanonicalTrack): Promise<ResolvedSource | null>;

  // Scoring
  // - Exact ISRC match: very high confidence
  // - Title + artist + duration within tolerance: high
  // - Title + artist only: medium
  // - Below threshold: reject (never auto-select low-confidence)
  score(candidate: SourceCandidate, track: CanonicalTrack): number;
}
```

### DownloadStateMachine

```typescript
// domain/services/download-state-machine.ts
export type DownloadStatus =
  | 'QUEUED'
  | 'RESOLVING'
  | 'DOWNLOADING'
  | 'PROCESSING'
  | 'FETCHING_LYRICS'
  | 'FINALIZING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'PAUSED'
  | 'EXPIRED';

export const DOWNLOAD_TRANSITIONS: Record<DownloadStatus, DownloadStatus[]> = {
  QUEUED: ['RESOLVING', 'CANCELLED', 'FAILED', 'PAUSED'],
  RESOLVING: ['DOWNLOADING', 'FAILED', 'CANCELLED'],
  DOWNLOADING: ['PROCESSING', 'FAILED', 'CANCELLED', 'PAUSED'],
  PROCESSING: ['FETCHING_LYRICS', 'FINALIZING', 'FAILED'],
  FETCHING_LYRICS: ['FINALIZING', 'FAILED'],
  FINALIZING: ['COMPLETED', 'FAILED'],
  COMPLETED: [], // Terminal
  FAILED: ['QUEUED', 'CANCELLED'], // Retry allowed
  CANCELLED: [], // Terminal
  PAUSED: ['QUEUED', 'CANCELLED'],
  EXPIRED: ['QUEUED'],
};

export class DownloadStateMachine {
  canTransition(from: DownloadStatus, to: DownloadStatus): boolean;
  transition(job: DownloadJob, to: DownloadStatus): void; // Throws if invalid
}
```

## Workers

### Download Worker

```typescript
// workers/download.worker.ts
import { Queue, Worker, Job } from 'bullmq';

export const downloadQueue = new Queue('downloads', { connection: redisConnection });

export const downloadWorker = new Worker(
  'downloads',
  async (job: Job) => {
    const { jobId, userId, trackId } = job.data;

    const stateMachine = new DownloadStateMachine();
    const jobRecord = await downloadRepo.getJob(jobId);

    try {
      // QUEUED -> RESOLVING
      stateMachine.transition(jobRecord.status, 'RESOLVING');
      await downloadRepo.update(jobId, { status: 'RESOLVING' });

      // Resolve permitted source
      const source = await sourceResolver.resolve(track);
      if (!source) {
        throw new SourceUnavailableError(trackId);
      }
      await downloadRepo.update(jobId, { sourceProvider: source.provider, sourceUrl: source.url });

      // RESOLVING -> DOWNLOADING
      stateMachine.transition('RESOLVING', 'DOWNLOADING');
      await downloadRepo.update(jobId, { status: 'DOWNLOADING', startedAt: new Date() });

      // Download with progress reporting
      const download = await storage.downloadToTmp(source.url, onProgress);
      await downloadRepo.updateProgress(jobId, download.progress);

      // DOWNLOADING -> PROCESSING
      // Validate audio, extract metadata, embed artwork
      stateMachine.transition('DOWNLOADING', 'PROCESSING');
      await processAudio(download.path);

      // PROCESSING -> FETCHING_LYRICS (best effort)
      stateMachine.transition('PROCESSING', 'FETCHING_LYRICS');
      const lyrics = await lyricsService.fetchBestEffort(track);
      if (lyrics) await attachLyrics(jobId, lyrics);

      // FETCHING_LYRICS -> FINALIZING
      stateMachine.transition('FETCHING_LYRICS', 'FINALIZING');

      // Compute checksum, upload to storage, persist metadata
      const checksum = await sha256(file);
      const objectKey = `downloads/${userId}/${trackId}.${format}`;
      await storage.put(objectKey, file, { acl: 'private' });

      // FINALIZING -> COMPLETED
      stateMachine.transition('FINALIZING', 'COMPLETED');
      await downloadRepo.update(jobId, {
        status: 'COMPLETED',
        completedAt: new Date(),
        checksum,
        objectKey,
      });

      // Notify
      await notificationService.downloadCompleted(userId, track, jobId);
      await realtime.emitToUser(userId, 'download:completed', { jobId, trackId });
    } catch (error) {
      const status = error instanceof CancelledError ? 'CANCELLED' : 'FAILED';
      await downloadRepo.update(jobId, { status, errorMessage: safeError(error) });
      await notificationService.downloadFailed(userId, track, jobId);
      if (status === 'FAILED' && job.attemptsMade < job.opts.attempts) {
        throw error; // BullMQ retries
      }
    }
  },
  {
    connection: redisConnection,
    concurrency: 4,
    limiter: { max: 20, duration: 1000 },
  },
);

async function onProgress(bytesDownloaded, bytesTotal) {
  await downloadRepo.updateProgress(jobId, { bytesDownloaded, bytesTotal });
  if (Date.now() - lastThrottle > 2000) {
    await realtime.emitToUser(userId, 'download:progress', { jobId, bytesDownloaded, bytesTotal });
    lastThrottle = Date.now();
  }
}
```

### Cleanup Worker

```typescript
// workers/cleanup.worker.ts
export const cleanupWorker = new Worker(
  'cleanup',
  async (job) => {
    switch (job.name) {
      case 'clean-temp-files':
        // Delete temp files older than 24h from /tmp
        break;
      case 'clean-expired-jobs':
        // Mark jobs stuck in DOWNLOADING > 12h as EXPIRED
        // Requeue PAUSED jobs older than 48h as FAILED
        break;
      case 'clean-old-notifications':
        // Purge notification rows older than retention policy
        break;
      case 'clean-provider-status':
        // Prune old provider_events
        break;
    }
  },
  { connection: redisConnection },
);

// Schedule
await downloadQueue.add('cleanup', {}, { repeat: { pattern: '0 3 * * *' } });
```

## Realtime Events

```typescript
// realtime/events.ts
export const RealtimeEvents = {
  // Downloads
  'download:created': { jobId: string; trackId: string },
  'download:progress': { jobId: string; bytesDownloaded: number; bytesTotal: number },
  'download:completed': { jobId: string; trackId: string },
  'download:failed': { jobId: string; trackId: string; reason: string },
  'download:batchProgress': { batchId: string; completed: number; total: number },

  // Playback sync
  'playback:state': { userId: string; trackId: string; position: number; state: string },

  // Account
  'account:updated': { user: PublicUser },
  'account:securityEvent': { type: string },

  // Playlists (collaborative)
  'playlist:updated': { playlistId: string; version: number },
  'playlist:trackAdded': { playlistId: string; trackId: string; position: number },
  'playlist:trackRemoved': { playlistId: string; trackId: string },

  // Notifications
  'notification:new': { id: string; type: string; title: string; body: string },

  // Admin
  'admin:metrics': { ... },
  'admin:providerStatus': { provider: string; status: string },
} as const;
```

## Caching Strategy

| Cache           | Key Pattern                | TTL   | Purpose                              |
| --------------- | -------------------------- | ----- | ------------------------------------ |
| Search results  | `search:{query}:{filters}` | 5m    | Expensive multi-provider searches    |
| Track metadata  | `track:{id}`               | 24h   | Provider metadata                    |
| Artist metadata | `artist:{id}`              | 24h   | Artist details                       |
| Album metadata  | `album:{id}`               | 24h   | Album details                        |
| Lyrics          | `lyrics:{trackId}`         | 24h   | Matched lyrics                       |
| Lyrics miss     | `lyrics:miss:{trackId}`    | 7d    | Avoid re-querying unavailable lyrics |
| Recommendations | `recs:{userId}`            | 30m   | Personalized recommendations         |
| Provider health | `provider:health:{name}`   | 30s   | Circuit breaker state                |
| Refresh tokens  | `refresh:{userId}`         | 30d   | Token revocation check               |
| Rate limits     | `ratelimit:{key}`          | 1m-1h | Sliding window                       |
| Session         | `session:{deviceId}`       | 30d   | Device sessions                      |

## Scaling Plan

### Stage 1 (MVP) - Single VM or small container cluster

- 1 API server process (multi-core, clustered)
- 1 worker process (or in-process BullMQ worker)
- 1 PostgreSQL
- 1 Redis
- Object storage (MinIO or S3)

### Stage 2 - Growth

- API servers behind load balancer (stateless)
- Dedicated worker pool (scale horizontally)
- PostgreSQL read replicas for search-heavy queries
- Redis persistence + clustering
- CDN for artwork/static content

### Stage 3 - Scale

- Extract recommendation service (compute-heavy)
- Extract download service (storage/network heavy)
- Dedicated search index (Meilisearch/Elasticsearch) for full-text
- Geographic replication for providers and object storage
- Message queue partitioning by user hash

## Observability

### Structured Logging (Pino)

```json
{
  "level": "info",
  "time": 1710000000000,
  "pid": 123,
  "req": { "id": "req_abc123", "method": "GET", "url": "/api/v1/music/search?q=test" },
  "userId": "usr_123",
  "service": "music-service",
  "operation": "search",
  "provider": "musicbrainz",
  "durationMs": 245,
  "result": "success"
}
```

### Metrics (Prometheus)

- HTTP: request count, latency histogram, error rate
- DB: query count, latency, connection pool usage
- Redis: cache hit rate, evictions, memory
- Queues: depth, processed, failed, stalled, latency
- Providers: request count, latency, error rate, success rate
- Downloads: started, completed, failed, throughput

### Alerts (Grafana)

- API error rate > 5% over 5m
- API p95 latency > 500ms
- Queue depth > 1000 for downloads
- Provider failure rate > 30%
- Worker dead (heartbeat miss > 2m)
- Disk > 80%
- Memory > 85%

## Admin System

### Admin Security

- Separate admin routes under `/api/v1/admin/*`
- Requires role >= MODERATOR
- MFA required for admin actions (TOTP)
- Every admin action written to `admin_logs` (immutable)
- Admin access from non-user-facing IP ranges (optional)
- Suspicious admin activity triggers alerts

### Admin Dashboard Data

- Active users (last 7d), new users, total users
- Downloads: started, completed, failed (today/7d/30d)
- Provider health: status, latency, success rate per provider
- API health: error rate, latency, uptime
- Storage: used, by category (audio, artwork, lyrics, temp)
- Queues: depth, stalled, failed
- Errors: top error categories (last 24h)
- Logs: searchable structured logs

### Admin Audit Log

```
admin_logs:
  id
  actor_id      -> user who performed action
  actor_role    -> role at time of action
  action        -> e.g. "USER.SUSPEND", "PROVIDER.DISABLE", "ROLE.CHANGE"
  target_type   -> e.g. "user", "provider", "setting"
  target_id
  before        -> JSON snapshot
  after         -> JSON snapshot
  ip            -> actor IP (hashed)
  timestamp
```

## Provider Registry

```typescript
// providers/registry.ts
export class ProviderRegistry {
  private metadataProviders: Map<string, MetadataProvider>;
  private sourceProviders: Map<string, SourceProvider>;
  private lyricsProviders: Map<string, LyricsProvider>;

  registerMetadata(name: string, provider: MetadataProvider): void;
  registerSource(name: string, provider: SourceProvider): void;
  registerLyrics(name: string, provider: LyricsProvider): void;

  getEnabledMetadata(): MetadataProvider[];
  getEnabledSources(): SourceProvider[];
  getEnabledLyrics(): LyricsProvider[];

  async healthCheckAll(): Promise<ProviderHealthReport[]>;
  disableProvider(name: string): void; // via feature flag / admin
  enableProvider(name: string): void;
}
```

Every provider is disabled without crashing the system if it fails; the registry uses circuit breakers and timeouts per provider call.

## Environment Configuration

```typescript
// config/env.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  STORAGE_PROVIDER: z.enum(['s3', 'minio', 'local']),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_BUCKET: z.string(),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
  FCM_SERVER_KEY: z.string().optional(),
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_BUNDLE_ID: z.string().optional(),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string(),
  SMTP_PASS: z.string(),
  PROVIDER_MUSICBRAINZ_BASE_URL: z.string().default('https://musicbrainz.org'),
  // ... other provider configs
  FEATURE_FLAG_PREFIX: z.string().default('ff:'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export const env = envSchema.parse(process.env);
```

Never commit `.env` files. Use `.env.example` with dummy values. All secrets come from environment or a secret manager (Vault/SSM).
