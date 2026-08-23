# M9 — Production Hardening (status)

Implemented during this session against the plan in `ARCHITECTURE_ROADMAP.md`
(Phase 9). All items are code-complete; anything requiring live infrastructure
(DSN, Grafana, app-store rollout) is wired and documented but unconfigured.

## M9.1 Observability

- **Logging redaction** — `apps/server/src/app.ts` adds a pino `redact` map
  covering `Authorization`, cookies, and `password`/`refreshToken`/`token` body
  fields, censored as `[REDACTED]`. Verified: no secrets appear in request logs.
- **Prometheus metrics** — `apps/server/src/lib/metrics.ts` is a dependency-free
  counter registry (`sinc_http_requests_total`, `sinc_http_errors_total`) exposed
  in text format at `GET /metrics` in `modules/health/routes.ts`, gated by
  `METRICS_ENABLED=true` (404 otherwise). Request/error counters are hooked into
  Fastify `onResponse` + the error handler. Ready for a Grafana/Prometheus scrape.
- **Analytics (opt-in, privacy-clean)** — `apps/server/src/modules/analytics/`
  (`service.ts`, `routes.ts`) with a new `AnalyticsEvent` table:
  - `POST /analytics/events` records batches of at most 200 events against a fixed
    allowlist (`search:success`, `playback:start`, `playback:complete`,
    `download:complete`, `lyrics:matched`) with an entity id + scalar metadata only
    — no query text, titles, or other PII.
  - `GET|PUT /analytics/preferences` reads/writes the opt-in flag in `User.settings`.
  - Events are dropped entirely unless the user opts in.
  - Mobile client `apps/mobile/src/services/analytics/analytics.ts` caches the
    preference locally and fires events fire-and-forget (never throws) from
    PlayerService (start/complete), downloadsStore (complete), lyricsStore
    (matched) and useSearch (success). The opt-in toggle lives in Security settings
    (Library → Security → "Anonymous usage stats"). Verified live: prefs default
    off, enabling persists, events recorded.
- **Sentry** — `apps/server/src/lib/observability.ts` + `initObservability()` in
  `server.ts`: no-op without `SENTRY_DSN`; loads `@sentry/node` lazily when set
  (warns if the package isn't installed). Install with `npm i @sentry/node` and
  set the DSN to activate.

## M9.2 Security & Performance

- **Rate limiting + abuse monitoring** — `@fastify/rate-limit@11` (upgraded from
  v9, which only supported Fastify 4) registered globally in `app.ts` with a
  per-IP cap from `RATE_LIMIT_MAX` (default 300/min) and `onExceeded` warn logs
  for abuse monitoring. Stricter caps on auth endpoints (`register` 10/min,
  `login` 20/min, `refresh` 30/min). Disabled entirely with
  `RATE_LIMIT_ENABLED=false`.
- **DB query optimization** — migration `m9_analytics_and_indexes` adds composite
  indexes for the hottest query patterns: `History(userId, playedAt)` (recently
  played / feed) and `Favorite(userId, targetType)` (library sync), plus the new
  Analytics table with `(userId, createdAt)` + `event` indexes.
- **Feature flags** — `apps/server/src/lib/feature-flags.ts` parses
  `FEATURE_FLAGS="name=on,other=off"` from env with in-memory overrides for tests.
  Ready to gate the new search ranking / recommendations rollout.
- **Backup/restore drill** — `scripts/backup.sh` (pg_dump → gzipped timestamped
  dump under `backups/`) and `scripts/restore.sh` (destructive restore). Verified
  end-to-end against a scratch database.

## M9.3 Release Readiness

- **App versioning + forced update** — `GET /app/version` returns
  `{ name, version, minAppVersion }` (from `MIN_APP_VERSION` env). Mobile
  `apps/mobile/src/services/updates/appUpdates.ts` compares semver (`APP_VERSION`
  `0.1.0`) and the `UpdateGate` in `RootNavigator` renders a blocking
  `UpdateRequiredScreen` when this build is below the minimum. Non-fatal: an
  unreachable API never blocks offline/library usage.
- Feature-flag-gated rollout of new ranking/recommendations: flag plumbing exists
  (M9.2) and is wired into the config; actual ranking changes are pending.
- Migration/QA matrix: the fresh-environment recovery (local Postgres init +
  full `prisma migrate dev` replay) doubles as the migration drill; the backup
  scripts cover the DR side.

## M9.4 Spotify playlist import (no-auth, full track list)

- **Motivation** — the Spotify Web API stopped exposing playlist items for
  arbitrary public links (Feb 2026 change) and requires OAuth for everything
  else, so there is no official unauthenticated read of a public playlist.
- **Bypass** — the public web player itself uses an anonymous path that the
  import reuses:
  1. **Anonymous token bootstrap** — a public embed page
     (`open.spotify.com/embed/track/{id}`) embeds a short-lived session token in
     its `__NEXT_DATA__` payload
     (`props.pageProps.state.settings.session.accessToken`); cached until near
     expiry (~1h) and refreshed on demand.
  2. **Pathfinder GraphQL** — with that token, `api-partner.spotify.com/
pathfinder/v1/query` is called with the persisted `fetchPlaylist` hash,
     paging by `offset`/`limit` (100/page). This returns the FULL playlist
     including the real `content.totalCount`, so the public embed page's 100
     track cap is bypassed. Verified live: "Rock Classics" reports 200 tracks
     and returns all 200 across 2 pages (the embed route only ever showed 100).
  3. **Embed fallback** — if the pathfinder route breaks (persisted-query hash
     rotation, token failure), the importer degrades to parsing the embed
     page's `__NEXT_DATA__` entity (100-track cap, `truncated: true`).
- **Server** — `apps/server/src/lib/spotify.ts`:
  - `parsePlaylistId()` accepts `open.spotify.com/playlist/...`,
    `embed/playlist/...` and `spotify:playlist:` URIs.
  - `fetchPlaylistTracks(id)` runs the token bootstrap + paginated pathfinder
    loop (safety cap 2000 tracks), returning `{ name, owner, artworkUrl,
totalCount, truncated, tracks[] }` with title/artist/duration per track.
  - `POST /music/import/spotify` (auth-required, body `{ url }`) resolves each
    fetched track to a canonical track: it tries iTunes search first, then
    Deezer search, using the existing variant-aware `pickBestMatch` (duration
    proximity, remix/live/cover penalties), and dedupes by normalized
    title+artist. Tracks neither provider can match are kept as synthetic
    canonical tracks built from the Spotify metadata — the download pipeline
    resolves those via YouTube/SoundCloud search, so **every** imported track can
    be saved, played, and downloaded. Returns the playlist metadata, the full
    `CanonicalTrack[]`, and `{ fetched, matched, unresolved, duplicates }` counts.
    Resolution runs in batches of 8 to avoid hammering the catalog APIs.
- **iTunes IP note** — Apple's iTunes Search API returns 403 from this server's
  datacenter IP (regardless of User-Agent), so iTunes matching often yields no
  candidates; the Deezer fallback covers the gap (the main search endpoint has
  the same pattern). A consumer/home IP would restore full iTunes matching.
- **Mobile** — Library → Playlists → "Import from Spotify" opens
  `apps/mobile/src/features/library/SpotifyImportScreen.tsx`: paste a link →
  fetch (shows artwork, name, owner, total count, matched/unresolved split,
  truncation warning) → either **Save as playlist** (`libraryStore.addPlaylist`)
  or **Download all** (sequential `downloadTrack` with live progress; individual
  failures don't abort the batch). Unresolved tracks are shown with a note that
  they'll be resolved via YouTube/SoundCloud. Matched tracks are playable
  immediately.
- **Known limitations** — truly private playlists still require OAuth (out of
  scope); imports are safety-capped at 2000 tracks; Spotify audio itself is
  DRM-protected so tracks are resolved to their available iTunes/Deezer/
  YouTube/SoundCloud equivalents rather than streamed from Spotify.

## Verification status

- Server: 141/141 tests, `tsc --noEmit` clean, ESLint clean.
- Mobile: 89/89 tests, `tsc --noEmit` clean, ESLint 0 errors (2 pre-existing
  warnings in PlaylistScreen).
- Live smoke: server boots, `/app/version` + `/metrics` (404 when disabled) +
  analytics prefs/events round-trip verified; no secrets in logs. Live import
  of Spotify's "Rock Classics" playlist returned all 200/200 tracks (totalCount
  200, embed-fallback flag off), matched 199 to catalog entries via the iTunes +
  Deezer fallback, and the single unmatched track ("Changes - 2013 Remaster")
  was kept as a synthetic Spotify track and successfully downloaded end-to-end
  via the YouTube source (100% complete, `.mp3` on disk) in ~30s.
- Requires infrastructure to activate: `SENTRY_DSN`, a running Prometheus/Grafana
  scrape target for `/metrics`, and a real Play Store listing URL for the
  forced-update button.
