# Sinc — Music Discovery, Playback, Downloads & Offline Library

**Sinc** is a production-grade, cross-platform (Android + iOS) music application combining discovery, unified search, playback, synchronized lyrics, downloads, and an offline-first personal library — built with a provider-agnostic architecture that keeps metadata discovery and playable/downloadable sources as separate concepts.

> This repository currently contains the **complete architecture and implementation roadmap**. Per the master prompt, no code is written until the architecture, database model, provider abstraction, mobile state model, background execution strategy, notification system, and download/playback state machines are fully defined and agreed upon.

## Architecture Documents

| #   | Deliverable             | Document                                                                     |
| --- | ----------------------- | ---------------------------------------------------------------------------- |
| A   | Product architecture    | [`ARCHITECTURE_PRODUCT.md`](ARCHITECTURE_PRODUCT.md)                         |
| B   | Mobile architecture     | [`ARCHITECTURE_MOBILE.md`](ARCHITECTURE_MOBILE.md)                           |
| B1  | Mobile — global stores  | [`ARCHITECTURE_MOBILE_STORES.md`](ARCHITECTURE_MOBILE_STORES.md)             |
| B2  | Mobile — query layer    | [`ARCHITECTURE_MOBILE_QUERY.md`](ARCHITECTURE_MOBILE_QUERY.md)               |
| B3  | Mobile — local database | [`ARCHITECTURE_MOBILE_DATABASE.md`](ARCHITECTURE_MOBILE_DATABASE.md)         |
| B4  | Mobile — repositories   | [`ARCHITECTURE_MOBILE_REPOSITORIES.md`](ARCHITECTURE_MOBILE_REPOSITORIES.md) |
| C   | Backend architecture    | [`ARCHITECTURE_BACKEND.md`](ARCHITECTURE_BACKEND.md)                         |
| D   | Database schema         | [`ARCHITECTURE_DATABASE.md`](ARCHITECTURE_DATABASE.md)                       |
| E   | API specification       | [`ARCHITECTURE_API.md`](ARCHITECTURE_API.md)                                 |
| F   | Provider architecture   | [`ARCHITECTURE_PROVIDERS.md`](ARCHITECTURE_PROVIDERS.md)                     |
| G   | Background architecture | [`ARCHITECTURE_BACKGROUND.md`](ARCHITECTURE_BACKGROUND.md)                   |
| H   | Security model          | [`ARCHITECTURE_SECURITY.md`](ARCHITECTURE_SECURITY.md)                       |
| I   | Testing strategy        | [`ARCHITECTURE_TESTING.md`](ARCHITECTURE_TESTING.md)                         |
| J   | Deployment architecture | [`ARCHITECTURE_DEPLOYMENT.md`](ARCHITECTURE_DEPLOYMENT.md)                   |
| K   | Build roadmap           | [`ARCHITECTURE_ROADMAP.md`](ARCHITECTURE_ROADMAP.md)                         |

## Key Architectural Decisions (summary)

1. **Metadata ≠ source.** MusicBrainz/Last.fm provide discovery; legally-permitted source providers (e.g., Internet Archive, Jamendo, Creative Commons) provide audio. The app never downloads protected audio.
2. **Provider abstraction.** Every provider is an isolated adapter behind `MetadataProvider` / `SourceProvider` / `LyricsProvider` interfaces, registered dynamically with circuit breakers. Adding/removing providers requires no core changes.
3. **Offline-first mobile.** WatermelonDB (SQLite) is the local source of truth; TanStack Query for server state; Zustand for client/playback/download state; optimistic mutations + sync queue + deterministic conflict resolution.
4. **Explicit state machines.** Downloads (`QUEUED→RESOLVING→DOWNLOADING→PROCESSING→FETCHING_LYRICS→FINALIZING→COMPLETED`) and playback (`IDLE→LOADING→BUFFERING→PLAYING⇄PAUSED→ENDED/ERROR`) are modeled, never boolean flags.
5. **Platform-honest background.** Android uses Media3 foreground service + DownloadManager + WorkManager; iOS uses AVAudioSession + URLSession background + BGAppRefreshTask. Everything persists state and recovers on process death.
6. **Security by default.** Argon2id, RS256 access (15m) + rotating hashed refresh tokens, RBAC server-enforced, MFA for admin writes, Keychain/Keystore client storage, signed URLs only, audit logs for all admin actions.
7. **Deterministic recommendations first.** Weighted familiar/similar/discovery (70/20/10, configurable), evolved later without redesign.

## Technology Stack

- **Mobile:** React Native 0.74+ / TypeScript, React Navigation, TanStack Query, Zustand, WatermelonDB, native modules (ExoPlayer/AVPlayer, DownloadManager/URLSession, FCM/APNs, Keychain/Keystore), Sentry.
- **Backend:** Node.js 20 / TypeScript, Fastify, PostgreSQL 16 + Prisma, Redis + BullMQ, S3-compatible object storage, Socket.io, Zod, Pino, Prometheus/Grafana.
- **Infra:** Docker, GitHub Actions, Terraform (optional), Cloudflare, Sentry, Testcontainers, Detox.

## Repository Layout (target)

```
Sinc/
├── ARCHITECTURE_*.md          # Architecture documents (this repo, present)
├── docs/                      # ADRs, setup, contribution (roadmap)
├── packages/
│   └── shared/                # Canonical types, DTOs, normalization (roadmap)
├── apps/
│   ├── backend/               # Fastify API + workers (roadmap)
│   └── mobile/                # React Native app (roadmap)
└── infrastructure/            # Docker, terraform, CI (roadmap)
```

## Roadmap Status

| Phase                         | Status                          |
| ----------------------------- | ------------------------------- |
| M0 — Repository & tooling     | Not started (awaiting approval) |
| M1 — Auth & foundation        | Not started                     |
| M2 — Core music experience    | Not started                     |
| M3 — Local library & offline  | Not started                     |
| M4 — Background systems       | Not started                     |
| M5 — Lyrics                   | Not started                     |
| M6 — Personalization          | Not started                     |
| M7 — Advanced mobile features | Not started                     |
| M8 — Administration           | Not started                     |
| M9 — Production hardening     | Not started                     |

See [`ARCHITECTURE_ROADMAP.md`](ARCHITECTURE_ROADMAP.md) for the full milestone breakdown and dependencies.

## Review Points / Decisions Needed

Before implementation begins, the following choices should be confirmed:

1. **Provider set** — which metadata providers (MusicBrainz, Last.fm, iTunes, Deezer metadata) and which legally-permitted source providers (Internet Archive, Jamendo, FMA) to integrate first.
2. **Local DB** — WatermelonDB (chosen) vs alternatives (Realm, SQLite + Drizzle).
3. **Real-time transport** — Socket.io (chosen) vs native WebSocket.
4. **Hosting** — Render/Fly/Railway (fast MVP) vs managed Kubernetes.
5. **Monorepo tooling** — Turborepo vs Nx.
6. **Push provider** — FCM + APNs direct vs Expo Push (if Expo used).
7. **Analytics** — PostHog (self-hosted option) vs Matomo vs Sentry-only for MVP.

## Legal Boundary (explicit)

Sinc resolves audio only from sources it is **legally permitted to access** (public domain, Creative Commons, open archives, and content the user has rights to). It does not download or extract protected audio from services where that behavior is prohibited. The provider abstraction and source-resolution scoring are designed to enforce this boundary, not to circumvent it.
