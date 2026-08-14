# Database Schema (PostgreSQL)

## Overview

All timestamps stored as `TIMESTAMPTZ` (UTC). All IDs are ULIDs (26-char sortable string IDs) generated server-side. Money/bytes stored as bigint where needed. Every provider-specific identifier is stored in dedicated `*_external_ids` tables, never merged into canonical tables.

## Entity Relationship Overview

```
users ─┬─ roles (many-to-many via user_roles)
       ├─ sessions (1-to-many)
       ├─ devices (1-to-many)
       ├─ playlists (1-to-many, owner)
       ├─ favorites (1-to-many)
       ├─ play_history (1-to-many)
       ├─ downloads (1-to-many)
       ├─ download_jobs (1-to-many)
       ├─ notifications (1-to-many)
       ├─ notification_preferences (1-to-1)
       ├─ user_settings (1-to-1)
       └─ listening_stats (1-to-1)

tracks ─┬─ artists (many-to-many via track_artists)
        ├─ album (many-to-1)
        ├─ track_sources (1-to-many)
        ├─ tracks_external_ids (1-to-many)
        ├─ lyrics (1-to-1)
        ├─ lyrics_versions (1-to-many)
        └─ playlist_tracks (1-to-many)

artists ─┬─ albums (1-to-many)
         ├─ artists_external_ids (1-to-many)
         └─ artist_genres (1-to-many)

albums ─┬─ tracks (1-to-many)
        └─ albums_external_ids (1-to-many)

playlists ─┬─ playlist_tracks (1-to-many)
           └─ playlist_collaborators (1-to-many)

recommendations (computed/cached per user)

provider_status / provider_events (system tables)

admin_logs (audit)
```

## Table Definitions

### users

```prisma
model User {
  id               String       @id @default(dbgenerated("gen_random_uuid()")) // or ULID via app
  email            String       @unique
  emailVerified    Boolean      @default(false)
  emailVerifiedAt  DateTime?
  passwordHash     String
  username         String       @unique
  displayName      String?
  avatarUrl        String?
  avatarObjectKey  String?
  role             Role         @default(USER)   // direct role for fast lookup
  status           UserStatus   @default(ACTIVE) // ACTIVE | SUSPENDED | DELETED | PENDING_DELETION
  statusReason     String?
  locale           String       @default("en")
  themePreference  String       @default("system")
  lastLoginAt      DateTime?
  lastLoginIp      String?
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
  deletedAt        DateTime?
  retentionPolicy  String       @default("default")

  // Relationships
  roles            UserRole[]
  sessions         Session[]
  devices          Device[]
  playlists        Playlist[]   @relation("PlaylistOwner")
  favorites        Favorite[]
  playHistory      PlayHistory[]
  downloads        Download[]
  downloadJobs     DownloadJob[]
  notifications    Notification[]
  notificationPrefs NotificationPreferences?
  settings         UserSettings?
  listeningStats   ListeningStats?
  adminLogs        AdminLog[]   @relation("AdminActor")

  @@index([status])
  @@index([email])
  @@index([username])
  @@index([createdAt])
}
```

### roles

```prisma
model Role {
  id          String   @id @default(dbgenerated("gen_random_uuid()"))
  name        RoleName @unique  // USER | MODERATOR | ADMIN | SUPER_ADMIN
  description String?
  createdAt   DateTime @default(now())
  users       UserRole[]
  permissions Permission[]
}

model Permission {
  id        String @id @default(dbgenerated("gen_random_uuid()"))
  action    String // e.g. "user.suspend", "provider.disable"
  role      Role
  roleId    String
  @@unique([roleId, action])
}

model UserRole {
  userId   String
  roleId   String
  assignedBy String?
  createdAt DateTime @default(now())
  @@id([userId, roleId])
  @@index([roleId])
}
```

### sessions

```prisma
model Session {
  id          String   @id @default(dbgenerated("gen_random_uuid()"))
  userId      String
  refreshTokenHash String // store hash, not raw token
  deviceId    String   // FK to devices
  expiresAt   DateTime
  revokedAt   DateTime?
  revokedBy   String?  // 'user' | 'admin' | 'security'
  createdAt   DateTime @default(now())
  lastUsedAt  DateTime @default(now())
  ipAddress   String?
  userAgent   String?
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
  @@index([deviceId])
}
```

### devices

```prisma
model Device {
  id              String   @id @default(dbgenerated("gen_random_uuid()"))
  userId          String
  platform        String   // 'android' | 'ios'
  model           String?
  osVersion       String?
  appVersion      String?
  pushToken       String?
  pushTokenType   String?  // 'fcm' | 'apns'
  pushTokenUpdatedAt DateTime?
  lastSeenAt      DateTime @default(now())
  isTrusted       Boolean  @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([pushToken])
}
```

### artists

```prisma
model Artist {
  id          String   @id @default(dbgenerated("gen_random_uuid()"))
  name        String
  normalizedName String @index() // normalized for search/dedup
  nameVariants String[] // aliases, spelling variants
  type        String?  // person | group | orchestra | choir
  biography   String?
  biographyUrl String?
  artworkUrl  String?
  artworkObjectKey String?
  followerCount Int?
  popularityScore Float?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  albums      Album[]
  tracks      TrackArtist[]
  externalIds ArtistsExternalIds[]
  genres      ArtistGenre[]
  listeningStats ListeningStats?

  @@index([name])
  @@index([normalizedName])
}
```

### artists_external_ids

```prisma
model ArtistsExternalIds {
  id         String   @id @default(dbgenerated("gen_random_uuid()"))
  artistId   String
  provider   String   // 'musicbrainz' | 'lastfm' | ...
  externalId String
  url        String?
  createdAt  DateTime @default(now())

  artist     Artist   @relation(fields: [artistId], references: [id], onDelete: Cascade)

  @@unique([artistId, provider, externalId])
  @@index([provider, externalId])
}
```

### artist_genres

```prisma
model ArtistGenre {
  id       String @id @default(dbgenerated("gen_random_uuid()"))
  artistId String
  genre    String
  @@unique([artistId, genre])
  @@index([genre])
}
```

### albums

```prisma
model Album {
  id             String   @id @default(dbgenerated("gen_random_uuid()"))
  title          String
  normalizedTitle String  @index()
  type           AlbumType @default(ALBUM) // ALBUM | SINGLE | EP | COMPILATION | SOUNDTRACK
  artistId       String?
  releaseDate    DateTime?
  releaseYear    Int?
  totalTracks    Int?
  totalDurationMs Int?
  artworkUrl     String?
  artworkObjectKey String?
  copyright      String?
  label          String?
  description    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  artist         Artist?  @relation(fields: [artistId], references: [id])
  tracks         Track[]
  externalIds    AlbumsExternalIds[]

  @@index([title])
  @@index([normalizedTitle])
  @@index([artistId])
  @@index([releaseDate])
}
```

### albums_external_ids

```prisma
model AlbumsExternalIds {
  id         String @id @default(dbgenerated("gen_random_uuid()"))
  albumId    String
  provider   String
  externalId String
  url        String?
  createdAt  DateTime @default(now())
  album      Album  @relation(fields: [albumId], references: [id], onDelete: Cascade)
  @@unique([albumId, provider, externalId])
  @@index([provider, externalId])
}
```

### tracks

```prisma
model Track {
  id             String   @id @default(dbgenerated("gen_random_uuid()"))
  title          String
  normalizedTitle String  @index()
  durationMs     Int
  version        String?  // "Remix", "Acoustic", "Live", "Instrumental"
  explicit       Boolean? @default(false)
  isrc           String?
  isrcNormalized String?  // normalized for matching
  releaseDate    DateTime?
  trackNumber    Int?
  discNumber     Int?
  language       String?
  popularityScore Float?
  artworkUrl     String?
  artworkObjectKey String?
  sourceRef      String?  // pointer to canonical source (hash of normalized metadata)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  albumId        String?
  album          Album?   @relation(fields: [albumId], references: [id])
  artists        TrackArtist[]
  sources        TrackSource[]
  externalIds    TracksExternalIds[]
  lyrics         Lyrics?
  lyricVersions  LyricsVersion[]
  playlistTracks PlaylistTrack[]
  favorites      Favorite[]
  playHistory    PlayHistory[]
  downloadJobs   DownloadJob[]
  recommendationsFrom ListeningStat?

  @@index([title])
  @@index([normalizedTitle])
  @@index([isrc])
  @@index([isrcNormalized])
  @@index([albumId])
  @@index([durationMs])
}
```

### track_artists (many-to-many with credit info)

```prisma
model TrackArtist {
  trackId   String
  artistId  String
  role      String  @default("main") // main | featuring | producer | writer
  order     Int     @default(0)
  createdAt DateTime @default(now())

  track     Track   @relation(fields: [trackId], references: [id], onDelete: Cascade)
  artist    Artist  @relation(fields: [artistId], references: [id], onDelete: Cascade)

  @@id([trackId, artistId, role, order])
  @@index([artistId])
  @@index([trackId])
}
```

### tracks_external_ids

```prisma
model TracksExternalIds {
  id         String @id @default(dbgenerated("gen_random_uuid()"))
  trackId    String
  provider   String
  externalId String
  url        String?
  createdAt  DateTime @default(now())
  track      Track  @relation(fields: [trackId], references: [id], onDelete: Cascade)
  @@unique([trackId, provider, externalId])
  @@index([provider, externalId])
}
```

### track_sources

```prisma
model TrackSource {
  id           String   @id @default(dbgenerated("gen_random_uuid()"))
  trackId      String
  provider     String   // source provider name
  sourceType   String   // 'stream' | 'download' | 'local'
  url          String?
  objectKey    String?  // for app-managed content
  format       String?  // 'mp3' | 'm4a' | 'flac' | 'opus'
  bitrate      Int?
  durationMs   Int?
  licenseType  String?  // 'permitted' | 'public_domain' | 'cc' | 'user_uploaded'
  isStreamable Boolean  @default(false)
  isDownloadable Boolean @default(false)
  confidence   Float?
  lastVerifiedAt DateTime?
  available    Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  track        Track    @relation(fields: [trackId], references: [id], onDelete: Cascade)

  @@index([trackId, provider])
  @@index([provider, available])
}
```

### playlists

```prisma
model Playlist {
  id          String   @id @default(dbgenerated("gen_random_uuid()"))
  title       String
  description String?
  artworkUrl  String?
  artworkObjectKey String?
  ownerId     String
  ownerType   String   @default("user") // user | system
  visibility  Visibility @default(PRIVATE) // PRIVATE | PUBLIC | UNLISTED
  isCollaborative Boolean @default(false)
  trackCount  Int      @default(0)
  totalDurationMs Int   @default(0)
  version     Int      @default(1) // optimistic concurrency
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  owner       User     @relation("PlaylistOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  tracks      PlaylistTrack[]
  collaborators PlaylistCollaborator[]

  @@index([ownerId])
  @@index([visibility, updatedAt])
  @@index([title])
}
```

### playlist_tracks

```prisma
model PlaylistTrack {
  id         String   @id @default(dbgenerated("gen_random_uuid()"))
  playlistId String
  trackId    String
  position   Int
  addedBy    String?
  addedAt    DateTime @default(now())
  createdAt  DateTime @default(now())

  playlist   Playlist @relation(fields: [playlistId], references: [id], onDelete: Cascade)
  track      Track    @relation(fields: [trackId], references: [id], onDelete: Cascade)

  @@unique([playlistId, trackId])
  @@unique([playlistId, position])
  @@index([trackId])
}
```

### playlist_collaborators

```prisma
model PlaylistCollaborator {
  id         String   @id @default(dbgenerated("gen_random_uuid()"))
  playlistId String
  userId     String
  role       String   @default("editor") // editor | viewer
  createdAt  DateTime @default(now())

  playlist   Playlist @relation(fields: [playlistId], references: [id], onDelete: Cascade)

  @@unique([playlistId, userId])
  @@index([userId])
}
```

### favorites

```prisma
model Favorite {
  id         String   @id @default(dbgenerated("gen_random_uuid()"))
  userId     String
  entityType String   // 'track' | 'artist' | 'album' | 'playlist'
  entityId   String
  createdAt  DateTime @default(now())

  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  track      Track?   @relation(fields: [entityId], references: [id], onDelete: Cascade)

  @@unique([userId, entityType, entityId])
  @@index([entityType, entityId])
  @@index([userId, createdAt])
}
```

### play_history

```prisma
model PlayHistory {
  id           String   @id @default(dbgenerated("gen_random_uuid()"))
  userId       String
  trackId      String
  positionMs   Int?
  durationMs   Int?
  completionPct Float?
  sourceType   String   // LOCAL | REMOTE | CACHED
  deviceId     String?
  playedAt     DateTime @default(now())
  completed    Boolean  @default(false)
  skipped      Boolean  @default(false)
  createdAt    DateTime @default(now())

  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  track        Track    @relation(fields: [trackId], references: [id], onDelete: Cascade)

  @@index([userId, playedAt])
  @@index([trackId, playedAt])
  @@index([userId, completed])
  @@index([userId, completionPct])
}
```

### listening_stats

```prisma
model ListeningStats {
  id                  String   @id @default(dbgenerated("gen_random_uuid()"))
  userId              String   @unique
  totalPlays          Int      @default(0)
  totalListenMs       BigInt   @default(0)
  totalUniqueTracks   Int      @default(0)
  avgCompletionPct    Float?
  topArtistIds        Json?    // [{artistId, plays}]
  topTrackIds         Json?    // [{trackId, plays}]
  genreCounts         Json?    // {genre: count}
  hourHistogram       Json?    // {0..23: count}
  lastCalculatedAt    DateTime @default(now())

  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([lastCalculatedAt])
}
```

### downloads

```prisma
model Download {
  id              String   @id @default(dbgenerated("gen_random_uuid()"))
  userId          String
  trackId         String
  status          DownloadStatus @default(QUEUED)
  progressPct     Int      @default(0)
  bytesDownloaded BigInt   @default(0)
  bytesTotal      BigInt?
  speedBps        BigInt?
  retryCount      Int      @default(0)
  errorCode       String?
  errorMessage    String?
  sourceProvider  String?
  sourceUrl       String?
  objectKey       String?
  fileFormat      String?
  fileSizeBytes   BigInt?
  checksum        String?
  quality         String   @default("high")
  includeLyrics   Boolean  @default(true)
  includeSyncedLyrics Boolean @default(true)
  includeArtwork  Boolean  @default(true)
  priority        Int      @default(50)
  batchId         String?  // FK to batch download
  createdAt       DateTime @default(now())
  startedAt       DateTime?
  completedAt     DateTime?
  expiresAt       DateTime?
  lastErrorAt     DateTime?

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  track           Track    @relation(fields: [trackId], references: [id], onDelete: Cascade)

  @@index([userId, status])
  @@index([trackId])
  @@index([batchId])
  @@index([createdAt])
}
```

### download_batches

```prisma
model DownloadBatch {
  id          String   @id @default(dbgenerated("gen_random_uuid()"))
  userId      String
  entityType  String   // 'playlist' | 'album' | 'artist' | 'custom'
  entityId    String?
  totalItems  Int
  completedItems Int   @default(0)
  failedItems Int      @default(0)
  status      String   @default("IN_PROGRESS")
  createdAt   DateTime @default(now())
  completedAt DateTime?
  downloads   Download[]

  @@index([userId, status])
}
```

### download_events

```prisma
model DownloadEvent {
  id         String   @id @default(dbgenerated("gen_random_uuid()"))
  downloadId String
  eventType  String   // 'created' | 'status_change' | 'progress' | 'error' | 'retry' | 'completed' | 'cancelled'
  fromStatus String?
  toStatus   String?
  details    Json?
  createdAt  DateTime @default(now())

  @@index([downloadId, createdAt])
}
```

### lyrics

```prisma
model Lyrics {
  id             String   @id @default(dbgenerated("gen_random_uuid()"))
  trackId        String   @unique
  provider       String
  text           Text?
  isSynced       Boolean  @default(false)
  syncedData     Json?    // [{timeMs, text}] or LRC string
  language       String?
  license        String?
  matchConfidence Float?
  offsetMs       Int      @default(0)
  fetchedAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  track          Track    @relation(fields: [trackId], references: [id], onDelete: Cascade)
  versions       LyricsVersion[]

  @@index([provider])
}
```

### lyric_versions

```prisma
model LyricsVersion {
  id         String   @id @default(dbgenerated("gen_random_uuid()"))
  lyricsId   String
  provider   String
  text       Text?
  isSynced   Boolean
  language   String?
  matchConfidence Float?
  fetchedAt  DateTime @default(now())
  createdAt  DateTime @default(now())

  lyrics     Lyrics   @relation(fields: [lyricsId], references: [id], onDelete: Cascade)

  @@unique([lyricsId, provider])
}
```

### notifications

```prisma
model Notification {
  id          String   @id @default(dbgenerated("gen_random_uuid()"))
  userId      String
  type        String   // 'download.completed' | 'download.failed' | 'account.security' | 'recommendation' | 'update' | ...
  title       String
  body        String
  data        Json?    // navigation payload
  categoryId  String   // stable category id for prefs
  channelId   String?  // Android channel
  isRead      Boolean  @default(false)
  readAt      DateTime?
  createdAt   DateTime @default(now())
  expiresAt   DateTime?

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, isRead])
  @@index([userId, createdAt])
  @@index([type])
}
```

### notification_preferences

```prisma
model NotificationPreferences {
  id            String  @id @default(dbgenerated("gen_random_uuid()"))
  userId        String  @unique
  downloads     Boolean @default(true)
  recommendations Boolean @default(false)
  account       Boolean @default(true)
  updates       Boolean @default(true)
  security      Boolean @default(true)
  playbackEvents Boolean @default(false)
  updatedAt     DateTime @updatedAt
  user          User    @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### user_settings

```prisma
model UserSettings {
  id          String   @id @default(dbgenerated("gen_random_uuid()"))
  userId      String   @unique
  playback    Json     @default("{}")
  downloads   Json     @default("{}")
  lyrics      Json     @default("{}")
  appearance  Json     @default("{}")
  privacy     Json     @default("{}")
  security    Json     @default("{}")
  dataSaver   Json     @default("{}")
  updatedAt   DateTime @updatedAt
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### recommendations

```prisma
model Recommendation {
  id          String   @id @default(dbgenerated("gen_random_uuid()"))
  userId      String
  kind        String   // 'familiar' | 'similar' | 'discovery' | 'mix'
  trackIds    Json     // ordered array of track IDs
  seed        Json?    // seed info (artistId, genre, etc.)
  reason      Json?    // why each track was recommended
  expiresAt   DateTime
  createdAt   DateTime @default(now())

  @@index([userId, kind])
  @@index([userId, expiresAt])
}
```

### provider_status

```prisma
model ProviderStatus {
  id              String   @id @default(dbgenerated("gen_random_uuid()"))
  provider        String   @unique
  type            String   // 'metadata' | 'source' | 'lyrics'
  enabled         Boolean  @default(true)
  healthy         Boolean  @default(true)
  lastHealthCheck DateTime?
  successRate     Float?
  avgLatencyMs    Int?
  totalRequests   Int      @default(0)
  totalFailures   Int      @default(0)
  consecutiveFailures Int  @default(0)
  circuitOpen     Boolean  @default(false)
  circuitOpenedAt DateTime?
  disabledReason  String?
  updatedAt       DateTime @updatedAt
}
```

### provider_events

```prisma
model ProviderEvent {
  id         String   @id @default(dbgenerated("gen_random_uuid()"))
  provider   String
  eventType  String   // 'request' | 'success' | 'failure' | 'circuit_open' | 'circuit_close' | 'disabled' | 'enabled'
  operation  String?  // 'search' | 'metadata' | 'resolve' | 'health'
  latencyMs  Int?
  errorCode  String?
  details    Json?
  createdAt  DateTime @default(now())

  @@index([provider, createdAt])
  @@index([eventType, createdAt])
}
```

### admin_logs

```prisma
model AdminLog {
  id          String   @id @default(dbgenerated("gen_random_uuid()"))
  actorId     String?
  actorRole   String?
  action      String   // 'USER.SUSPEND' | 'PROVIDER.DISABLE' | 'ROLE.CHANGE' | ...
  targetType  String   // 'user' | 'provider' | 'role' | 'setting' | 'system'
  targetId    String?
  before      Json?
  after       Json?
  ipHash      String?
  source      String?  // 'admin_api' | 'worker' | 'system'
  createdAt   DateTime @default(now())

  actor       User?    @relation("AdminActor", fields: [actorId], references: [id])

  @@index([actorId])
  @@index([action])
  @@index([targetType, targetId])
  @@index([createdAt])
}
```

### feature_flags

```prisma
model FeatureFlag {
  id          String   @id @default(dbgenerated("gen_random_uuid()"))
  key         String   @unique
  description String?
  enabled     Boolean  @default(false)
  percentage  Float?   // rollout percentage 0-100
  userSegment Json?    // { role: [...], userIds: [...] }
  startAt     DateTime?
  endAt       DateTime?
  createdBy   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### notifications_tokens / push (handled via devices table)

Push tokens are stored on the `devices` table (`pushToken`, `pushTokenType`). A user can have multiple devices; push is sent to all devices of the user unless device-specific opt-out.

## Indexing Strategy

| Table               | Index                            | Purpose               |
| ------------------- | -------------------------------- | --------------------- |
| tracks              | `normalizedTitle` + `durationMs` | Dedup lookup          |
| tracks              | `isrcNormalized`                 | Exact ISRC match      |
| tracks_external_ids | `(provider, externalId)`         | Provider lookup       |
| play_history        | `(userId, playedAt)`             | Recent history        |
| play_history        | `(userId, completionPct)`        | Completion-based recs |
| favorites           | `(userId, createdAt)`            | Recent favorites      |
| downloads           | `(userId, status)`               | User's download list  |
| notifications       | `(userId, isRead)`               | Unread badge          |
| provider_events     | `(provider, createdAt)`          | Health metrics        |

## Retention Policies

| Table           | Retention              |
| --------------- | ---------------------- |
| play_history    | 90 days (configurable) |
| download_events | 30 days                |
| provider_events | 14 days                |
| notifications   | 60 days                |
| admin_logs      | 365 days (immutable)   |
| refresh tokens  | 30 days (TTL)          |
| tmp files       | 24 hours               |

## Full-Text Search Strategy

- `normalizedTitle`, `normalizedName` columns enable fast dedup + lookup
- For full-text search, use PostgreSQL `tsvector` with a generated column + GIN index
- At scale, move to dedicated search engine (Meilisearch/Elasticsearch) with the same normalization pipeline

```prisma
model Track {
  // ...
  searchVector Unsupported("tsvector")? @db.Vector
  @@index([searchVector], type: Gin)
}
```

## Optimistic Concurrency

- `playlists.version` incremented on every update
- Client sends `version` in updates; mismatch returns `CONFLICT`
- Playlist track order changes use the version to detect concurrent edits
- Favorites/history use `updated_at` timestamps for conflict resolution

## Backups

- Daily full backup (pg_dump or WAL archiving to S3)
- WAL archiving every 5 minutes for PITR
- 30-day retention for daily backups
- Weekly restore verification test
- Backups encrypted at rest and in transit
