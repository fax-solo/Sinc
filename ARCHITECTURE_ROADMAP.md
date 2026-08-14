# Build Roadmap (Milestones)

## Guiding Principles

- Each milestone is independently testable and shippable
- Never dump thousands of lines at once â€” work in vertical slices
- Critical architecture decisions land before features that depend on them
- Every milestone ends with: test â†’ check error states â†’ check background behavior â†’ check Android/iOS differences â†’ document decisions

## Phase 0 â€” Repository & Tooling

### M0.1 Monorepo Scaffold

- [ ] Monorepo (npm workspaces / turborepo): `apps/mobile`, `apps/backend`, `packages/shared`
- [ ] Shared TypeScript types package (`packages/shared`): CanonicalTrack, Artist, Album, Playlist, API DTOs
- [ ] ESLint + Prettier + TypeScript strict config everywhere
- [ ] Husky pre-commit hooks (lint, typecheck, gitleaks)
- [ ] CI: GitHub Actions for backend + mobile

### M0.2 Backend Bootstrap

- [ ] Fastify app skeleton, health endpoint, request ID, structured logging
- [ ] Prisma + PostgreSQL setup with initial migration
- [ ] Redis connection + BullMQ queue skeleton
- [ ] Zod validation middleware + error envelope
- [ ] Docker compose dev stack
- [ ] Tests: health route, error envelope

### M0.3 Mobile Bootstrap

- [ ] React Native app (TS) with navigation shell (React Navigation)
- [ ] Design system tokens + core components (Button, Card, ListItem, Skeleton, EmptyState, ErrorState)
- [ ] Theme system (light/dark/system) + RTL-ready
- [ ] QueryClient + Zustand wiring + WatermelonDB skeleton
- [ ] i18n scaffolding (English + Arabic, RTL layout test)
- [ ] Native module bridge skeleton (AudioPlayer, DownloadManager, Notifications, SecureStorage)

**Exit criteria:** Empty app with design system, tabs, theme switch, i18n, and tests pass.

## Phase 1 â€” Authentication & Core Foundation

### M1.1 Auth Backend

- [ ] Register / login / refresh / logout / verify email / password reset
- [ ] Argon2id hashing, JWT RS256 access + rotating refresh (hashed at rest)
- [ ] Sessions + devices + revocation
- [ ] Rate limiting + account security notifications
- [ ] Tests: full auth lifecycle + token reuse detection

### M1.2 Auth Mobile

- [ ] Onboarding flow (welcome, account, preferences, finish)
- [ ] Login / register / verification / reset screens
- [ ] Auth store + secure token storage (Keychain/Keystore)
- [ ] Biometric unlock option (settings)
- [ ] Auth error states (invalid creds, not verified, suspended)

### M1.3 User Profile & Settings

- [ ] Profile screen, edit profile, avatar upload (signed URL)
- [ ] Settings screens (playback, downloads, lyrics, notifications, appearance, privacy, security)
- [ ] Account deletion flow
- [ ] Tests: settings persistence + sync

## Phase 2 â€” Core Music Experience

### M2.1 Provider Layer + Normalization

- [ ] Provider interfaces + registry + circuit breakers
- [ ] Metadata provider adapter: MusicBrainz (search, artist, album, track)
- [ ] Track normalizer + search scorer + deduplicator (pure domain, fully unit-tested)
- [ ] Canonical model in `packages/shared`
- [ ] Provider fixtures + integration tests (mocked HTTP)

### M2.2 Search Backend

- [ ] `/music/search` (multi-provider fan-out, dedup, score, rank, paginate)
- [ ] Search cache (Redis) + debounce-friendly `suggest`
- [ ] Provider fallback chain
- [ ] Tests: misspellings, partial, multi-word, dedup (5 providers â†’ 1 track)

### M2.3 Search Mobile

- [ ] Search screen (recent searches, suggestions, debounced instant search)
- [ ] Search results (grouped: songs/artists/albums/playlists) + filters + infinite scroll
- [ ] Search error/empty/offline states

### M2.4 Detail Screens Backend

- [x] `/music/tracks/:id`, `/music/artists/:id`, `/music/albums/:id`, `/music/playlists/:id`
- [x] Source availability endpoint (`/music/tracks/:id/sources`)
- [x] Home feed aggregation endpoint (`/home`)

### M2.5 Detail Screens Mobile

- [x] Song details (actions: play, play next, queue, playlist, favorite, download, share, lyrics)
- [x] Artist details (top tracks, albums, related, favorite)
- [x] Album details (track list, play/shuffle/download)
- [x] Playlist details (track list, play/shuffle, edit if owner)
- [x] Skeleton loading + error/empty states everywhere

### M2.6 Player Backend + Source Resolution

- [x] Source resolver (ISRC-first scoring, confidence threshold)
- [x] Playback source endpoints with signed URLs
- [x] Tests: never auto-selects low-confidence; provider failure degrades

### M2.7 Player Mobile (Foreground)

- [x] Playback state machine + playback store + native audio bridge
- [x] Mini-player + full player UI (progress, seek, prev/next, shuffle, repeat, favorite, queue, lyrics entry)
- [x] Queue management (reorder, remove, play next, clear, persist)
- [x] Audio focus / interruptions / headset / bluetooth events

## Phase 3 â€” Local Library & Offline

### M3.1 Local Database Layer

- [x] WatermelonDB full schema + repositories
- [x] Library screens (tracks, artists, albums, playlists, favorites, history)
- [x] Sorting/filtering
- [x] Local search over library

### M3.2 Playlists + Favorites (bidirectional sync)

- [x] Playlist CRUD, reorder (versioned), duplicate, collaborative scaffolding
- [x] Favorites (track/artist/album), offline optimistic + sync queue
- [x] Conflict resolution (favorite union, playlist versioning)
- [x] Tests: sync + conflict outcomes

### M3.3 Downloads (foreground)

- [x] Download state machine (client + server mirror)
- [x] Download queue UI, progress, pause/resume/cancel/retry/prioritize
- [x] Download jobs persisted + reconciled on start
- [x] Download storage management screen (usage by category, cleanup)

### M3.4 Offline Mode

- [ ] Offline detection + global network banner
- [ ] Browse/play downloaded content offline
- [ ] Offline-aware error states ("You are offlineâ€¦")
- [ ] Data saver mode (Wi-Fi only, reduced artwork, lower quality)

## Phase 4 â€” Background Systems

### M4.1 Background Playback

- [x] Android: Media3 foreground service + media notification + audio focus + MediaSession
- [x] iOS: AVAudioSession background + Now Playing + RemoteCommandCenter
- [x] Lock screen controls on both platforms
- [x] Tests: manual QA matrix + Detox smoke

### M4.2 Background Downloads

- [x] Android: DownloadManager integration + reconciliation receiver
- [ ] iOS: URLSession background session + delegate (deferred — Android-only per decision)
- [x] Progress throttling + aggregate batch notifications
- [x] Low-storage detection + warnings

### M4.3 Background Sync

- [ ] Android WorkManager + iOS BGAppRefreshTask
- [ ] Sync queue replay (history, favorites, playlist edits, settings)
- [ ] Interrupted-op recovery on cold start

### M4.4 Notifications

- [ ] Notification service (local + push), channels, categories, preferences
- [ ] Push: FCM + APNs registration + server sender
- [ ] Notification screens (list, unread, prefs)
- [ ] Realtime (WebSocket) events: download progress, account events

### M4.5 Lifecycle Recovery

- [ ] Cold/warm start recovery sequence
- [ ] Playback position persistence + "Continue Listening"
- [ ] Download job reconciliation
- [ ] Crash recovery + Sentry

## Phase 5 â€” Lyrics

### M5.1 Lyrics Service Backend

- [ ] Lyrics provider abstraction + LyricMatcher (pure, tested)
- [ ] LRCLIB adapter (synced LRC) + Genius adapter (plain)
- [ ] Cache (match 24h / miss 7d), provider fallback
- [ ] `GET /lyrics/tracks/:id`

### M5.2 Synced Lyrics Player Mobile

- [ ] Lyrics screen: line highlighting, auto-scroll, tap-to-seek, timing offset
- [ ] Plain-text fallback UI
- [ ] Download-with-lyrics pipeline (audio succeeds even if lyrics fail)

## Phase 6 â€” Personalization

### M6.1 Recommendations Backend

- [ ] Recommendation engine (deterministic, weighted familiar/similar/discovery 70/20/10, configurable)
- [ ] Listening stats (play count, completion, skips, recency, genres)
- [ ] Quick mixes (favorites, chill, recently played, discovery, artist, genre)
- [ ] `GET /recommendations/*` + `/home` wiring

### M6.2 Personalization Mobile

- [ ] Home feed sections (greeting, continue listening, recently played/downloaded, favorites, playlists, recommended, mixes)
- [ ] History screen + stats
- [ ] Skip/feedback capture for future models

## Phase 7 â€” Advanced Mobile Features

### M7.1 Deep Links & Sharing

- [ ] Universal/app links config (iOS + Android)
- [ ] Deep link routing (song/artist/album/playlist, logged-in/out, deleted content)
- [ ] Native share sheet + share link generation

### M7.2 Accessibility & RTL polish

- [ ] Full accessibility pass (labels, roles, states, focus, dynamic type)
- [ ] Arabic/RTL QA pass (icons, direction, typography, numbers, pluralization)
- [ ] Haptics + reduced-motion compliance

### M7.3 Biometric Security

- [ ] Biometric app lock, downloads lock, settings lock (optional, fallback PIN)
- [ ] App lifecycle re-lock on background

### M7.4 Widgets / Vehicle extension points

- [ ] Architecture hooks for home-screen widgets (currently playing, quick play)
- [ ] Android Auto (MediaBrowserService) + CarPlay (MPPlayableContentManager) â€” interface stubs documented

## Phase 8 â€” Administration

### M8.1 Admin Backend

- [ ] Roles (USER/MODERATOR/ADMIN/SUPER_ADMIN) + permissions + RBAC enforcement
- [ ] MFA (TOTP) for admin writes
- [ ] Admin API: dashboard, users, providers, logs, health, feature flags
- [ ] Audit logging for every admin action

### M8.2 Admin Mobile (or Web)

- [ ] Admin screens (dashboard, users, providers, logs, system health)
- [ ] Admin error/empty/loading states
- [ ] Provider health display + disable/enable

## Phase 9 â€” Production Hardening

### M9.1 Observability

- [ ] Sentry (backend + mobile, source maps)
- [ ] Prometheus/Grafana dashboards + alerts
- [ ] Structured logging audit (no secrets, redaction)
- [ ] Analytics (opt-in, privacy-clean): search success, playback start/complete, download events, lyrics matched

### M9.2 Security & Performance

- [ ] Security audit (OWASP ASVS Level 2) + pentest fixes
- [ ] Rate limit tuning + abuse monitoring
- [ ] Performance pass: cold start, render budgets, DB query optimization
- [ ] Load test + queue throughput test
- [ ] Backup/restore drill + DR test

### M9.3 Release Readiness

- [ ] Feature flags rollout for new search ranking, recommendations
- [ ] App versioning + forced update path (critical security)
- [ ] Migration testing (dev â†’ staging â†’ prod, zero-downtime)
- [ ] Final manual QA matrix (all platforms)

## Milestone Dependency Graph

```
M0.1 â”€â”¬â”€ M0.2 â”€ M1.1 â”€ M2.1 â”€ M2.2 â”€ M2.4 â”€ M2.6 â”€â”€â”€â”€ (backend)
      â””â”€ M0.3 â”€ M1.2 â”€ M1.3 â”€ M2.3 â”€ M2.5 â”€ M2.7 â”€â”€â”€â”€ (mobile)
                          M3.1 â”€ M3.2 â”€ M3.3 â”€ M3.4
                          M4.1 â”€ M4.2 â”€ M4.3 â”€ M4.4 â”€ M4.5
                          M5.1 â”€ M5.2
                          M6.1 â”€ M6.2
                          M7.1 â”€ M7.2 â”€ M7.3 â”€ M7.4
                          M8.1 â”€ M8.2
                          M9.1 â”€ M9.2 â”€ M9.3
```

## MVP Definition (M0â€“M4 + M5 + M6.2 + essentials of M7/M8)

The first usable release ships after M0â€“M6 with basic admin (M8.1 core) and hardening essentials:

- Auth + onboarding
- Home, Search, Song/Artist/Album/Playlist details
- Player + queue (foreground + background)
- Downloads + background downloads + storage management
- Notifications (local + push basics)
- Lyrics + synced lyrics
- Favorites, playlists, recently played/downloaded
- Offline playback
- Settings
- Basic admin dashboard + user management
- Sentry + structured logging

Everything beyond that iterates (M7 advanced, M8 full admin, M9 hardening).

## Definition of "Done" per Milestone

1. Code implemented behind the designed architecture (no shortcuts to happy path only)
2. Unit tests pass (domain â‰¥90%)
3. Integration/E2E tests pass where applicable
4. Loading / empty / error / offline states present
5. Android + iOS differences handled explicitly
6. Background/lifecycle behavior verified where relevant
7. Accessibility + RTL + dark mode verified
8. No secrets; logging/analytics events present
9. Architecture decisions documented (ADRs)
10. CI green
