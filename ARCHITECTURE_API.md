# API Specification

## Base URL & Versioning

- Base URL: `https://api.sinc.app/api/v1/`
- Development: `http://localhost:3000/api/v1/`
- All timestamps: ISO 8601 UTC (`2026-08-13T10:00:00.000Z`)
- All IDs: ULID strings (26 chars)
- Content-Type: `application/json` (requests and responses)

## Authentication

### Headers

```
Authorization: Bearer <access_token>
X-Device-Id: <device_uuid>       // identifies device (for sessions)
X-Client-Version: 1.2.0          // app version (for update checks)
X-Platform: android|ios
```

### Token Lifecycle

| Token                                      | TTL               | Storage (client)  | Purpose               |
| ------------------------------------------ | ----------------- | ----------------- | --------------------- |
| Access token (JWT, RS256)                  | 15 minutes        | Keychain/Keystore | Authorize API calls   |
| Refresh token (opaque, hashed server-side) | 30 days (rolling) | Keychain/Keystore | Get new access tokens |

### Refresh Flow

```
POST /auth/refresh
Body: { refreshToken, deviceId }
→ 200 { accessToken, refreshToken, expiresIn }
```

Refresh tokens rotate on every use. Old refresh tokens are revoked.

### Error Responses

All errors use a consistent envelope:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Access token has expired",
    "details": null
  },
  "requestId": "req_abc123",
  "serverTime": "2026-08-13T10:00:00.000Z"
}
```

### HTTP Status Codes

| Code | Meaning                                |
| ---- | -------------------------------------- |
| 200  | OK                                     |
| 201  | Created                                |
| 204  | No Content                             |
| 400  | Validation error                       |
| 401  | Unauthenticated / token expired        |
| 403  | Forbidden (insufficient role)          |
| 404  | Not found                              |
| 409  | Conflict (version mismatch, duplicate) |
| 429  | Rate limited                           |
| 500  | Internal error                         |

## Common Types

```typescript
// Common
interface PaginationParams {
  page?: number; // default 1
  limit?: number; // default 20, max 100
  sort?: string;
  order?: 'asc' | 'desc';
}

interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
  };
}

// Music
interface Artist {
  id: string;
  name: string;
  artworkUrl?: string;
  genres: string[];
  followerCount?: number;
  isFavorite: boolean;
}

interface Album {
  id: string;
  title: string;
  artist: ArtistLite;
  artworkUrl?: string;
  releaseDate?: string;
  trackCount: number;
  totalDurationMs: number;
  type: 'ALBUM' | 'SINGLE' | 'EP' | 'COMPILATION' | 'SOUNDTRACK';
  isSaved: boolean;
}

interface Track {
  id: string;
  title: string;
  artists: ArtistLite[];
  album?: AlbumLite;
  durationMs: number;
  artworkUrl?: string;
  isrc?: string;
  releaseDate?: string;
  explicit: boolean;
  version?: string;
  popularityScore?: number;
  isFavorite: boolean;
  downloadStatus: 'NOT_DOWNLOADED' | 'QUEUED' | 'DOWNLOADING' | 'DOWNLOADED' | 'FAILED';
  playableSource?: SourceInfo;
}

interface SourceInfo {
  provider: string;
  type: 'stream' | 'download';
  url?: string; // signed URL, short-lived
  format?: string;
  quality?: string;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
}

interface Playlist {
  id: string;
  title: string;
  description?: string;
  artworkUrl?: string;
  owner: UserLite;
  trackCount: number;
  totalDurationMs: number;
  visibility: 'PRIVATE' | 'PUBLIC' | 'UNLISTED';
  isCollaborative: boolean;
  isOwner: boolean;
  version: number;
}
```

---

## Auth Endpoints

### POST /auth/register

Create a new account.

```json
Request:
{
  "email": "user@example.com",
  "password": "Str0ng!Passw0rd",
  "username": "musicfan",
  "displayName": "Music Fan",
  "locale": "en"
}

Response 201:
{
  "success": true,
  "data": {
    "user": { "id": "...", "email": "user@example.com", "username": "musicfan", "role": "USER" },
    "accessToken": "eyJ...",
    "refreshToken": "rot...",
    "expiresIn": 900
  },
  "requestId": "req_1",
  "serverTime": "2026-08-13T10:00:00.000Z"
}
```

### POST /auth/login

```json
Request: { "email": "...", "password": "..." }
Response 200: { user, accessToken, refreshToken, expiresIn }
```

### POST /auth/refresh

```json
Request: { "refreshToken": "rot...", "deviceId": "device-uuid" }
Response 200: { accessToken, refreshToken, expiresIn }
```

### POST /auth/logout

```json
Request: { "refreshToken": "rot...", "deviceId": "device-uuid" }
Response 204
```

### POST /auth/verify-email

```json
Request: { "token": "verification-token" }
Response 200: { user, accessToken, refreshToken, expiresIn }
```

### POST /auth/resend-verification

```json
Request: { "email": "..." }
Response 204
```

### POST /auth/password-reset/request

```json
Request: { "email": "..." }
Response 204  // always 204 to avoid user enumeration
```

### POST /auth/password-reset/confirm

```json
Request: { "token": "...", "password": "NewPassw0rd!" }
Response 204
```

### GET /auth/me

Return current user profile.

```
Response 200:
{ user: { id, email, username, displayName, avatarUrl, role, status, createdAt, settings } }
```

### GET /auth/sessions

List active sessions/devices.

```
Response 200:
{ sessions: [{ id, deviceId, platform, lastUsedAt, isCurrent, ipHash }] }
```

### DELETE /auth/sessions/:id

Revoke a specific session.

### POST /auth/sessions/revoke-all

Sign out all devices.

---

## User Endpoints

### GET /users/me

Alias for /auth/me.

### PATCH /users/me

Update profile.

```json
Request (partial):
{
  "displayName": "New Name",
  "username": "newname",
  "avatarUrl": "https://...",
  "locale": "ar"
}
Response 200: { user }
```

### PATCH /users/me/settings

Update user settings (playback, downloads, lyrics, appearance, privacy, security).

```json
Request:
{
  "playback": { "crossfade": 5, "volumeNormalization": true },
  "downloads": { "wifiOnly": true, "maxConcurrent": 3 }
}
Response 200: { settings }
```

### DELETE /users/me

Delete account (identity confirmation required).

```json
Request: { "password": "...", "confirmation": "DELETE" }
Response 204
```

---

## Music Endpoints

### GET /music/search

Unified search across providers.

```
Query params:
  q            (required) search query
  type         songs|artists|albums|playlists (default: all)
  artist       filter by artist name
  album        filter by album name
  durationMin  milliseconds
  durationMax  milliseconds
  downloaded   true|false
  favorite     true|false
  page, limit, sort, order

Response 200:
{
  "data": {
    "tracks": { "data": [...], "meta": {...} },
    "artists": { "data": [...], "meta": {...} },
    "albums": { "data": [...], "meta": {...} },
    "playlists": { "data": [...], "meta": {...} }
  }
}
```

### GET /music/search/suggest

Search suggestions (typeahead).

```
Query params: q, limit (default 8)
Response 200: { suggestions: [{ type, id, text, subtitle, artworkUrl }] }
```

### GET /music/tracks/:id

Track details with user state.

```
Response 200: { track: Track, related: Track[], sources: SourceInfo[], lyricsAvailable: boolean }
```

### GET /music/tracks/:id/sources

Playable/downloadable sources.

```
Response 200: { sources: SourceInfo[], best: SourceInfo | null }
```

### GET /music/artists/:id

```
Response 200: { artist: Artist, topTracks: Track[], albums: Album[], relatedArtists: Artist[], playlistsWithArtist: Playlist[] }
```

### GET /music/artists/:id/tracks

```
Response 200: Paginated<Track>
```

### GET /music/artists/:id/albums

```
Response 200: Paginated<Album>
```

### GET /music/albums/:id

```
Response 200: { album: Album, tracks: Track[], artist: Artist }
```

### GET /music/albums/:id/tracks

```
Response 200: Paginated<Track>
```

### GET /music/playlists/:id

```
Response 200: { playlist: Playlist, tracks: Paginated<Track> }
```

### GET /music/playlists/:id/tracks

```
Response 200: Paginated<Track>
```

---

## Home Endpoints

### GET /home

Personalized home feed (aggregates multiple sections in one request).

```
Response 200:
{
  "greeting": { "username": "musicfan", "avatarUrl": "...", "unreadNotifications": 3 },
  "continueListening": [...],     // tracks with progress
  "recentlyPlayed": [...],
  "recentlyDownloaded": [...],
  "favorites": [...],
  "playlists": [...],
  "recommendedForYou": [...],
  "quickMixes": [...]
}
```

---

## Playlist Endpoints

### GET /playlists

User's playlists.

```
Query: page, limit, sort
Response 200: Paginated<Playlist>
```

### POST /playlists

```json
Request:
{
  "title": "My Mix",
  "description": "Chill vibes",
  "isCollaborative": false,
  "visibility": "PRIVATE",
  "trackIds": ["tr_1", "tr_2"]
}
Response 201: { playlist }
```

### GET /playlists/:id

```
Response 200: { playlist, tracks: Paginated<Track> }
```

### PATCH /playlists/:id

```json
Request (partial, requires version):
{ "version": 5, "title": "...", "description": "...", "visibility": "PUBLIC" }
Response 200: { playlist }
```

### DELETE /playlists/:id

```
Response 204
```

### POST /playlists/:id/tracks

```json
Request: { "version": 5, "trackIds": ["tr_x", "tr_y"], "position": 3 }
Response 200: { playlist, position: [...] }
```

### DELETE /playlists/:id/tracks/:trackId

```json
Request: { "version": 5 }
Response 200: { playlist }
```

### PUT /playlists/:id/tracks/order

Reorder tracks.

```json
Request: { "version": 5, "trackIds": ["tr_3", "tr_1", "tr_2", ...] }
Response 200: { playlist }
```

### POST /playlists/:id/duplicate

```
Response 201: { playlist }
```

### POST /playlists/:id/download

Queue all permitted tracks for download.

```
Response 202: { batch: { id, totalItems, status } }
```

---

## Favorites Endpoints

### GET /favorites

```
Query: type=track|artist|album, page, limit
Response 200: Paginated<Favorite>
```

### GET /favorites/check?trackId=:id

```
Response 200: { isFavorite: boolean }
```

### POST /favorites

```json
Request: { "entityType": "track", "entityId": "tr_1" }
Response 201: { favorite }
```

### DELETE /favorites/:entityType/:entityId

```
Response 204
```

---

## History Endpoints

### GET /history

```
Query: page, limit, from, to, sourceType
Response 200: Paginated<PlayHistoryEntry>
```

### GET /history/stats

```
Response 200: {
  totalPlays, totalListenMs, totalSongsPlayed,
  topArtists: [{artist, playCount}],
  topTracks: [{track, playCount}],
  favoriteGenres: [{genre, count}],
  recentActivity: [...]
}
```

### POST /history

Batch sync play history from device (used by background sync).

```json
Request:
{
  "entries": [
    { "trackId": "tr_1", "positionMs": 120000, "durationMs": 240000, "completionPct": 50, "playedAt": "...", "sourceType": "LOCAL" }
  ],
  "lastSyncedAt": "..."
}
Response 200: { "accepted": 12, "duplicates": 1 }
```

---

## Recommendations Endpoints

### GET /recommendations/for-you

```
Query: page, limit
Response 200: Paginated<Track> with "reason" hint on each
```

### GET /recommendations/similar?trackId=:id

```
Response 200: Paginated<Track>
```

### GET /recommendations/artist-mix?artistId=:id

```
Response 200: { mix: { id, title, tracks: [...] } }
```

### GET /recommendations/genre-mix?genre=:genre

```
Response 200: { mix: { id, title, tracks: [...] } }
```

### GET /recommendations/discovery

```
Response 200: Paginated<Track>
```

### GET /recommendations/quick-mixes

```
Response 200: { mixes: [{ id, title, description, type, trackCount, seed }] }
```

---

## Downloads Endpoints

### POST /downloads

```json
Request:
{
  "trackId": "tr_1",
  "quality": "high",
  "includeLyrics": true,
  "includeSyncedLyrics": true,
  "includeArtwork": true
}
Response 202:
{ "job": { "id": "dl_1", "trackId": "tr_1", "status": "QUEUED" } }
```

### GET /downloads

```
Query: status=QUEUED|RESOLVING|DOWNLOADING|PROCESSING|FETCHING_LYRICS|FINALIZING|COMPLETED|FAILED|CANCELLED|PAUSED, page, limit
Response 200: Paginated<DownloadJob>
```

### GET /downloads/:id

```
Response 200: { job: DownloadJob }
```

### POST /downloads/:id/cancel

```
Response 200: { job }
```

### POST /downloads/:id/retry

```
Response 202: { job }
```

### POST /downloads/:id/prioritize

```
Response 200: { job }
```

### GET /downloads/:id/file

Generate a short-lived signed URL for the completed file.

```
Response 200: { url, expiresAt, fileName, mimeType, sizeBytes }
```

### GET /downloads/stats

```
Response 200: { total, completed, active, queued, failed, totalBytes }
```

### GET /downloads/batches/:id

Aggregate progress for a batch (playlist download).

```
Response 200: { batch: { id, entityType, totalItems, completedItems, failedItems, status }, jobs: [...] }
```

---

## Lyrics Endpoints

### GET /lyrics/tracks/:id

```
Response 200:
{
  "lyrics": {
    "provider": "lrclib",
    "isSynced": true,
    "text": "plain text...",
    "syncedLines": [{ "timeMs": 0, "text": "..." }],
    "language": "en",
    "offsetMs": 0,
    "matchConfidence": 0.97
  }
}
```

---

## Notifications Endpoints

### GET /notifications

```
Query: type, read, page, limit
Response 200: Paginated<Notification>
```

### GET /notifications/unread-count

```
Response 200: { count: 3 }
```

### POST /notifications/read-all

```
Response 204
```

### POST /notifications/:id/read

```
Response 204
```

### GET /notifications/preferences

```
Response 200: { preferences: { downloads, recommendations, account, updates, security, playbackEvents } }
```

### PATCH /notifications/preferences

```json
Request: { "recommendations": true }
Response 200: { preferences }
```

### POST /notifications/devices

Register push token.

```json
Request: { "deviceId": "...", "platform": "android", "pushToken": "fcm-token", "osVersion": "14", "appVersion": "1.2.0" }
Response 201
```

### DELETE /notifications/devices/:deviceId

Unregister push token.

---

## Settings Endpoints

### GET /settings

```
Response 200: { settings: { playback, downloads, lyrics, appearance, privacy, security, dataSaver } }
```

### PATCH /settings

Merge partial updates (same shape as PATCH /users/me/settings).

### GET /settings/storage

```
Response 200: {
  "totalBytes": 128000000000,
  "appUsage": { "audio": 0, "artwork": 0, "lyrics": 0, "cache": 0, "temp": 0 },
  "downloads": { "count": 150, "bytes": 12000000000 }
}
```

---

## Share / Deep Link Endpoints

### POST /share

Generate a shareable deep link.

```json
Request: { "entityType": "song|artist|album|playlist", "entityId": "..." }
Response 200: { "url": "https://sinc.app/song/tr_1", "shortUrl": "https://sinc.app/s/AbCd1234" }
```

---

## Feature Flags (public, for client behavior)

### GET /features

Return enabled features + flags for current user.

```
Response 200: { "flags": { "smartOffline": true, "widgets": false, "vehicleMedia": false } }
```

---

## Admin Endpoints

All admin endpoints require role >= MODERATOR (some require ADMIN/SUPER_ADMIN). All actions are audited.

### GET /admin/dashboard

```
Response 200:
{
  "users": { "total": 1000, "active30d": 800, "newToday": 12, "suspended": 3 },
  "downloads": { "total": 5000, "completedToday": 120, "failedToday": 5, "active": 30 },
  "providers": [{ "name", "type", "enabled", "healthy", "successRate", "avgLatencyMs", "lastHealthCheck" }],
  "api": { "requests1h": 5000, "errorRate": 0.02, "p95LatencyMs": 120 },
  "storage": { "usedBytes": 0, "byCategory": { "audio": 0, "artwork": 0, "lyrics": 0, "temp": 0 } },
  "queues": { "downloads": { "depth": 10, "stalled": 0, "failed": 2 } },
  "errors": [{ "category": "PROVIDER_TIMEOUT", "count": 15, "lastSeen": "..." }]
}
```

### GET /admin/users

```
Query: search, role, status, page, limit
Response 200: Paginated<AdminUser>
```

### GET /admin/users/:id

```
Response 200: { user, stats: { favorites, playlists, downloads, plays }, sessions: [...] }
```

### POST /admin/users/:id/suspend

```json
Request: { "reason": "Terms violation", "durationDays": 30 }
Response 200
```

### POST /admin/users/:id/restore

```
Response 200
```

### PATCH /admin/users/:id/role

```json
Request: { "role": "MODERATOR", "reason": "..." }
Response 200
```

### DELETE /admin/users/:id

Force-delete an account (with audit trail).

### GET /admin/providers

```
Response 200: { providers: [{ name, type, enabled, healthy, successRate, avgLatencyMs, totalRequests, totalFailures, circuitOpen, disabledReason }] }
```

### POST /admin/providers/:name/disable

```json
Request: { "reason": "Outage" }
Response 200
```

### POST /admin/providers/:name/enable

```
Response 200
```

### POST /admin/providers/:name/health-check

Force a health check.

```
Response 200: { result: "healthy" | "unhealthy", latencyMs, details }
```

### GET /admin/logs

```
Query: level, service, userId, action, from, to, page, limit
Response 200: Paginated<AdminLogEntry>
```

### GET /admin/health

```
Response 200:
{
  "status": "ok" | "degraded" | "down",
  "checks": {
    "database": { "status": "ok", "latencyMs": 2 },
    "redis": { "status": "ok", "latencyMs": 1 },
    "queue": { "status": "ok", "depth": 10 },
    "storage": { "status": "ok" },
    "workers": { "download": "alive", "lyrics": "alive" }
  }
}
```

### GET /admin/feature-flags

```
Response 200: { flags: [...] }
```

### PATCH /admin/feature-flags/:key

```json
Request: { "enabled": true, "percentage": 50 }
Response 200
```

---

## Rate Limiting

| Endpoint Group                  | Limit                         |
| ------------------------------- | ----------------------------- |
| Auth (login, register, refresh) | 10/min per IP, 50/hour per IP |
| Password reset requests         | 3/hour per email              |
| Search                          | 30/min per user               |
| General API                     | 100/min per user, 300/hour    |
| Admin                           | 30/min per user               |
| Provider-heavy (sources)        | 20/min per user               |

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

On limit: `429` with `Retry-After` header.

## Pagination

- `limit` default 20, max 100
- `page` starts at 1
- Use cursor-based pagination (`cursor` + `limit`) for very large datasets (history, logs)

## Idempotency

- `POST /downloads` accepts `Idempotency-Key` header to prevent duplicate job creation on retry
- `POST /history` is naturally idempotent (deduplicated by trackId + playedAt)

## Request IDs

- Every response includes `requestId` (generated on ingest, propagated to logs, workers, and downstream calls)
- Client should send `X-Request-Id` for correlation on retries
