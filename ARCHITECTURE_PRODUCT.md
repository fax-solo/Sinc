# Product Architecture

## Overview

Sinc is a cross-platform mobile music application that unifies music discovery, search, playback, lyrics, downloads, and library management into a single cohesive product. The architecture separates **metadata discovery** from **playable/downloadable sources**, enabling a provider-agnostic system that can legally access content from multiple sources.

## Core Product Boundaries

### What Sinc Does

- **Metadata Discovery**: Search, browse, and discover music across multiple metadata providers
- **Unified Search**: Fuzzy, multi-provider search with deduplication and scoring
- **Playback**: Local and remote playback with full media session integration
- **Lyrics**: Synchronized and plain-text lyrics with provider fallback
- **Downloads**: Asynchronous, resumable downloads from legally permitted sources
- **Library Management**: Local library with offline-first capabilities
- **Personalization**: Favorites, history, playlists, recommendations
- **Background Operations**: Background audio, downloads, sync

### What Sinc Does NOT Do

- Download or extract protected audio from services where prohibited
- Assume any single provider equals an audio source
- Bypass DRM or access controls
- Store user credentials for third-party services

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        MOBILE APPLICATION                        │
├─────────────────────────────────────────────────────────────────┤
│  UI Layer (React Native + Native Modules)                       │
│  ├── Navigation (React Navigation v6)                           │
│  ├── Design System (Custom)                                     │
│  └── Platform Integrations (Native Modules)                     │
├─────────────────────────────────────────────────────────────────┤
│  Presentation State (React Query + Zustand)                     │
├─────────────────────────────────────────────────────────────────┤
│  Application/Use Cases (Domain-Driven)                          │
├─────────────────────────────────────────────────────────────────┤
│  Domain Layer (Pure TypeScript)                                 │
│  ├── Entities: Track, Artist, Album, Playlist, User, etc.       │
│  ├── Value Objects: TrackId, ArtistId, Duration, etc.           │
│  ├── Domain Services: SearchScorer, RecommendationEngine, etc.  │
│  └── Domain Events                                              │
├─────────────────────────────────────────────────────────────────┤
│  Repository Layer (Interfaces)                                  │
├─────────────────────────────────────────────────────────────────┤
│  Data Sources                                                   │
│  ├── API Client (TanStack Query + Axios)                        │
│  ├── Local Database (WatermelonDB / SQLite)                     │
│  ├── Native Platform Services (Audio, Downloads, Notifications) │
│  └── Secure Storage (Keychain/Keystore)                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND SERVICES                         │
├─────────────────────────────────────────────────────────────────┤
│  API Gateway (Fastify/Express + TypeScript)                     │
│  ├── Authentication & Authorization                             │
│  ├── Rate Limiting & Validation                                 │
│  └── Request/Response Transformation                            │
├─────────────────────────────────────────────────────────────────┤
│  Application Services                                           │
│  ├── User Management                                            │
│  ├── Music Metadata (Search, Browse, Details)                   │
│  ├── Playlist Management                                        │
│  ├── Favorites & History                                        │
│  ├── Recommendations                                            │
│  ├── Download Orchestration                                     │
│  ├── Lyrics Resolution                                          │
│  └── Notifications                                              │
├─────────────────────────────────────────────────────────────────┤
│  Domain Services                                                │
│  ├── Search Scoring & Deduplication                             │
│  ├── Source Resolution                                          │
│  ├── Recommendation Engine                                      │
│  └── Lyric Matching                                             │
├─────────────────────────────────────────────────────────────────┤
│  Provider Adapters                                              │
│  ├── Metadata Providers (MusicBrainz, Last.fm, etc.)            │
│  ├── Source Providers (Legal sources only)                      │
│  ├── Lyrics Providers (LRCLIB, Genius, etc.)                    │
│  └── Provider Registry & Health Monitoring                      │
├─────────────────────────────────────────────────────────────────┤
│  Infrastructure                                                 │
│  ├── PostgreSQL (Primary)                                       │
│  ├── Redis (Cache, Sessions, Queues)                            │
│  ├── Object Storage (S3-compatible)                             │
│  ├── Message Queue (BullMQ/Redis)                               │
│  └── WebSocket Server (Socket.io)                               │
└─────────────────────────────────────────────────────────────────┘
```

## Key Architectural Decisions

### 1. Provider Abstraction

All external integrations go through provider adapters implementing a common interface. The core domain never depends on provider-specific types.

### 2. Metadata vs. Source Separation

- **Metadata Providers**: Provide search, browse, metadata (MusicBrainz, Last.fm, etc.)
- **Source Providers**: Provide playable/downloadable audio from legally permitted sources
- A track can have metadata from Provider A and audio from Source B

### 3. Offline-First Mobile Architecture

- Local SQLite database (WatermelonDB) as source of truth for UI
- Background sync with backend when online
- Optimistic UI updates with conflict resolution

### 4. State Machines for Critical Flows

- Download State Machine: QUEUED → RESOLVING → DOWNLOADING → PROCESSING → FETCHING_LYRICS → FINALIZING → COMPLETED
- Playback State Machine: IDLE → LOADING → BUFFERING → PLAYING ↔ PAUSED → ENDED/ERROR

### 5. Platform-Specific Native Modules

- Audio: Native modules using ExoPlayer (Android) / AVPlayer (iOS)
- Downloads: Native download managers (DownloadManager / URLSession)
- Notifications: Native notification channels
- Background: Platform-specific background execution APIs

## Data Flow Overview

### Search Flow

```
User Query
    │
    ▼
Search Use Case
    │
    ├──► Search Metadata Providers (parallel)
    │       │
    │       ▼
    │   Normalize to CanonicalTrack
    │       │
    │       ▼
    │   Deduplicate & Score
    │       │
    │       ▼
    │   Rank & Return Results
    │
    └──► Cache Results (Redis + Local)
```

### Playback Flow

```
User Plays Track
    │
    ▼
Playback Use Case
    │
    ├──► Resolve Source (Source Resolver)
    │       │
    │       ▼
    │   Score Available Sources
    │       │
    │       ▼
    │   Select Best Permitted Source
    │
    ▼
Initialize Native Player
    │
    ├──► Local File → Direct Playback
    ├──► Remote URL → Stream with Buffering
    └──► Cached → Hybrid Playback
    │
    ▼
Update Media Session / Now Playing
    │
    ▼
Persist Playback State
```

### Download Flow

```
User Requests Download
    │
    ▼
Create Download Job (QUEUED)
    │
    ▼
Background Worker Picks Job
    │
    ▼
RESOLVING: Source Resolver finds permitted source
    │
    ▼
DOWNLOADING: Native Download Manager
    │
    ▼
PROCESSING: Validate, Extract Metadata, Embed Artwork
    │
    ▼
FETCHING_LYRICS: Fetch & Cache Lyrics
    │
    ▼
FINALIZING: Store in Local DB, Update Library
    │
    ▼
COMPLETED: Notify User, Update Library
```

## Module Boundaries

### Mobile App Modules

```
src/
├── app/                    # App entry, providers, navigation
├── features/               # Feature-based modules
│   ├── auth/
│   ├── home/
│   ├── search/
│   ├── library/
│   ├── player/
│   ├── downloads/
│   ├── lyrics/
│   ├── playlists/
│   ├── favorites/
│   ├── history/
│   ├── recommendations/
│   ├── settings/
│   ├── profile/
│   └── admin/
├── shared/                 # Shared across features
│   ├── ui/                 # Design system components
│   ├── navigation/         # Navigation utilities
│   ├── state/              # Global stores (auth, playback, downloads)
│   ├── api/                # API client, queries, mutations
│   ├── database/           # Local database models, repositories
│   ├── native/             # Native module bridges
│   ├── domain/             # Shared domain types, value objects
│   ├── utils/              # Utilities
│   └── constants/
├── core/                   # Core architecture
│   ├── use-cases/          # Application use cases
│   ├── domain/             # Domain entities, services, events
│   ├── repositories/       # Repository interfaces
│   └── di/                 # Dependency injection
└── platforms/              # Platform-specific code
    ├── ios/
    └── android/
```

### Backend Modules

```
backend/
├── src/
│   ├── api/                # API routes, controllers, middleware
│   ├── app/                # Application services (use cases)
│   ├── domain/             # Domain entities, services, events
│   ├── providers/          # Provider adapters
│   │   ├── metadata/
│   │   ├── sources/
│   │   ├── lyrics/
│   │   └── registry/
│   ├── infrastructure/     # Database, cache, queue, storage
│   ├── workers/            # Background job processors
│   ├── realtime/           # WebSocket handlers
│   ├── admin/              # Admin-specific services
│   ├── config/             # Configuration
│   └── main.ts             # Entry point
├── prisma/                 # Database schema & migrations
└── tests/
```

## Communication Patterns

### Mobile ↔ Backend

- **REST API** (v1): Primary communication for CRUD operations
- **WebSocket**: Real-time updates (download progress, playlist changes, notifications)
- **Signed URLs**: Direct object storage access for downloads/uploads

### Mobile Internal

- **React Query**: Server state management (caching, deduping, background refetch)
- **Zustand**: Client state (UI state, playback queue, download queue UI)
- **WatermelonDB**: Local persistence (offline-first, reactive)
- **Events**: Domain events for cross-feature communication

### Backend Internal

- **Message Queue (BullMQ)**: Async job processing (downloads, lyrics, recommendations)
- **Domain Events**: Internal service communication
- **Redis Pub/Sub**: Real-time notifications, cache invalidation

## Scalability Strategy

### Phase 1 (MVP)

- Single API server
- Single worker process
- Single Redis instance
- Single PostgreSQL instance
- Object storage (MinIO/S3)

### Phase 2 (Scale)

- Multiple API servers behind load balancer
- Horizontal worker scaling
- Redis Cluster
- PostgreSQL read replicas
- CDN for static assets

### Phase 3 (High Scale)

- Microservice extraction (if justified)
- Geographic distribution
- Advanced caching layers
- Dedicated search cluster (Elasticsearch/Meilisearch)

## Technology Choices

### Mobile

| Layer           | Technology                                   | Rationale                                           |
| --------------- | -------------------------------------------- | --------------------------------------------------- |
| Framework       | React Native 0.74+                           | Cross-platform, native performance, large ecosystem |
| Navigation      | React Navigation v6                          | Type-safe, performant, deep linking support         |
| State (Server)  | TanStack Query v5                            | Caching, deduping, background sync, offline support |
| State (Client)  | Zustand                                      | Lightweight, TypeScript-friendly, no provider hell  |
| Local DB        | WatermelonDB                                 | SQLite-backed, reactive, offline-first, performant  |
| Networking      | Axios + TanStack Query                       | Interceptors, TypeScript, cancellation              |
| Native Bridge   | TurboModules / Nitro Modules                 | Performant, type-safe native communication          |
| Audio           | ExoPlayer (Android) / AVPlayer (iOS)         | Native media engines, background support            |
| Downloads       | DownloadManager (Android) / URLSession (iOS) | Native background downloads, OS-managed             |
| Notifications   | FCM (Push) + Local Notifications             | Cross-platform push + local scheduling              |
| Secure Storage  | react-native-keychain                        | Keychain/Keystore backed, biometric support         |
| Crash Reporting | Sentry                                       | Source maps, breadcrumbs, performance               |
| Analytics       | PostHog (self-hosted option)                 | Privacy-friendly, feature flags                     |

### Backend

| Layer          | Technology                   | Rationale                                              |
| -------------- | ---------------------------- | ------------------------------------------------------ |
| Runtime        | Node.js 20+ (TypeScript)     | Type safety, shared types with mobile, large ecosystem |
| Framework      | Fastify                      | Performance, schema validation, TypeScript support     |
| Database       | PostgreSQL 16                | ACID, JSONB, full-text search, mature                  |
| ORM            | Prisma                       | Type-safe, migrations, great DX                        |
| Cache/Queue    | Redis 7 + BullMQ             | Pub/sub, streams, job queues, clustering               |
| Object Storage | MinIO (dev) / S3 (prod)      | S3-compatible, self-hostable                           |
| Real-time      | Socket.io                    | Fallbacks, rooms, auto-reconnect                       |
| Auth           | JWT (RS256) + Refresh Tokens | Stateless, short-lived access tokens                   |
| Validation     | Zod                          | Schema validation, TypeScript inference                |
| Logging        | Pino                         | Structured, fast, child loggers                        |
| Metrics        | Prometheus + Grafana         | Industry standard, alerting                            |
| Tracing        | OpenTelemetry                | Distributed tracing                                    |
| Testing        | Vitest                       | Fast, TypeScript-native, Vite integration              |

## Error Handling Strategy

### Mobile

- **Network Errors**: Classified (retryable, non-retryable, auth) with exponential backoff
- **Native Errors**: Mapped to domain errors with user-friendly messages
- **Offline**: Graceful degradation, queue mutations for sync
- **Crash Boundary**: Error boundaries per feature, Sentry reporting

### Backend

- **Structured Errors**: Error codes, HTTP status, user-safe messages
- **Validation**: Zod schemas on all inputs, detailed validation errors
- **Rate Limiting**: Per-endpoint, per-user, per-IP with sliding window
- **Circuit Breakers**: For provider calls, prevent cascade failures
- **Dead Letter Queues**: For failed background jobs with retry logic

## Observability

### Mobile

- **Crash Reporting**: Sentry (source maps, breadcrumbs)
- **Performance**: React Native Performance Monitor + Sentry
- **User Analytics**: PostHog (privacy-respecting, opt-in)
- **Network Logging**: Axios interceptors for debug builds

### Backend

- **Structured Logging**: Pino with request IDs, correlation IDs
- **Metrics**: Prometheus (HTTP latency, DB latency, queue depth, error rates)
- **Tracing**: OpenTelemetry (HTTP, DB, Redis, external calls)
- **Alerting**: Grafana alerts on error rates, latency, queue backlogs
- **Audit Logs**: Immutable admin action logs

## Security Model Summary

- **Authentication**: JWT (RS256) access tokens (15min) + rotating refresh tokens (30 days)
- **Authorization**: Role-based (USER, MODERATOR, ADMIN, SUPER_ADMIN) enforced server-side
- **Mobile Storage**: Keychain/Keystore for tokens, biometric protection optional
- **Network**: TLS 1.3 everywhere, certificate pinning for API
- **Provider Calls**: Server-side only, never expose provider APIs to client
- **Downloads**: Signed URLs with short expiry, no direct storage access
- **Admin**: Separate admin API, MFA required, audit logging

## Future Extension Points

- **Android Auto / Apple CarPlay**: MediaBrowserService / CarPlay MPPlayableContentManager
- **Widgets**: Glanceable UI via App Widgets / WidgetKit
- **Wearables**: MediaController integration
- **Collaborative Features**: WebRTC for listening parties, shared playlists
- **Advanced Audio**: Equalizer, crossfade, gapless playback, spatial audio
- **Cloud Sync**: Optional iCloud/Google Drive backup for library metadata
