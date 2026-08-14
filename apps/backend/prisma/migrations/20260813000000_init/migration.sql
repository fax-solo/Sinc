-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED', 'PENDING_DELETION');

-- CreateEnum
CREATE TYPE "AlbumType" AS ENUM ('ALBUM', 'SINGLE', 'EP', 'COMPILATION', 'SOUNDTRACK');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PRIVATE', 'PUBLIC', 'UNLISTED');

-- CreateEnum
CREATE TYPE "DownloadStatus" AS ENUM ('QUEUED', 'RESOLVING', 'DOWNLOADING', 'PROCESSING', 'FETCHING_LYRICS', 'FINALIZING', 'COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "passwordHash" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "avatarObjectKey" TEXT,
    "role" "RoleName" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "themePreference" TEXT NOT NULL DEFAULT 'system',
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "retentionPolicy" TEXT NOT NULL DEFAULT 'default',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" "RoleName" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "model" TEXT,
    "osVersion" TEXT,
    "appVersion" TEXT,
    "pushToken" TEXT,
    "pushTokenType" TEXT,
    "pushTokenUpdatedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isTrusted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "nameVariants" TEXT[],
    "type" TEXT,
    "biography" TEXT,
    "biographyUrl" TEXT,
    "artworkUrl" TEXT,
    "artworkObjectKey" TEXT,
    "followerCount" INTEGER,
    "popularityScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistsExternalIds" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistsExternalIds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistGenre" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "genre" TEXT NOT NULL,

    CONSTRAINT "ArtistGenre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Album" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "type" "AlbumType" NOT NULL DEFAULT 'ALBUM',
    "artistId" TEXT,
    "releaseDate" TIMESTAMP(3),
    "releaseYear" INTEGER,
    "totalTracks" INTEGER,
    "totalDurationMs" INTEGER,
    "artworkUrl" TEXT,
    "artworkObjectKey" TEXT,
    "copyright" TEXT,
    "label" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Album_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlbumsExternalIds" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlbumsExternalIds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "version" TEXT,
    "explicit" BOOLEAN DEFAULT false,
    "isrc" TEXT,
    "isrcNormalized" TEXT,
    "releaseDate" TIMESTAMP(3),
    "trackNumber" INTEGER,
    "discNumber" INTEGER,
    "language" TEXT,
    "popularityScore" DOUBLE PRECISION,
    "artworkUrl" TEXT,
    "artworkObjectKey" TEXT,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "albumId" TEXT,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackArtist" (
    "trackId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'main',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackArtist_pkey" PRIMARY KEY ("trackId","artistId","role","order")
);

-- CreateTable
CREATE TABLE "TracksExternalIds" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TracksExternalIds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackSource" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "url" TEXT,
    "objectKey" TEXT,
    "format" TEXT,
    "bitrate" INTEGER,
    "durationMs" INTEGER,
    "licenseType" TEXT,
    "isStreamable" BOOLEAN NOT NULL DEFAULT false,
    "isDownloadable" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "lastVerifiedAt" TIMESTAMP(3),
    "available" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "artworkUrl" TEXT,
    "artworkObjectKey" TEXT,
    "ownerId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL DEFAULT 'user',
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "isCollaborative" BOOLEAN NOT NULL DEFAULT false,
    "trackCount" INTEGER NOT NULL DEFAULT 0,
    "totalDurationMs" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaylistTrack" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "addedBy" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaylistTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaylistCollaborator" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'editor',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaylistCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "positionMs" INTEGER,
    "durationMs" INTEGER,
    "completionPct" DOUBLE PRECISION,
    "sourceType" TEXT NOT NULL,
    "deviceId" TEXT,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListeningStats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalPlays" INTEGER NOT NULL DEFAULT 0,
    "totalListenMs" BIGINT NOT NULL DEFAULT 0,
    "totalUniqueTracks" INTEGER NOT NULL DEFAULT 0,
    "avgCompletionPct" DOUBLE PRECISION,
    "topArtistIds" JSONB,
    "topTrackIds" JSONB,
    "genreCounts" JSONB,
    "hourHistogram" JSONB,
    "lastCalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListeningStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Download" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "status" "DownloadStatus" NOT NULL DEFAULT 'QUEUED',
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "bytesDownloaded" BIGINT NOT NULL DEFAULT 0,
    "bytesTotal" BIGINT,
    "speedBps" BIGINT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "sourceProvider" TEXT,
    "sourceUrl" TEXT,
    "objectKey" TEXT,
    "fileFormat" TEXT,
    "fileSizeBytes" BIGINT,
    "checksum" TEXT,
    "quality" TEXT NOT NULL DEFAULT 'high',
    "includeLyrics" BOOLEAN NOT NULL DEFAULT true,
    "includeSyncedLyrics" BOOLEAN NOT NULL DEFAULT true,
    "includeArtwork" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),

    CONSTRAINT "Download_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DownloadBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "totalItems" INTEGER NOT NULL,
    "completedItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DownloadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DownloadEvent" (
    "id" TEXT NOT NULL,
    "downloadId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DownloadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lyrics" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "text" TEXT,
    "isSynced" BOOLEAN NOT NULL DEFAULT false,
    "syncedData" JSONB,
    "language" TEXT,
    "license" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "offsetMs" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lyrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LyricsVersion" (
    "id" TEXT NOT NULL,
    "lyricsId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "text" TEXT,
    "isSynced" BOOLEAN NOT NULL,
    "language" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LyricsVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "categoryId" TEXT NOT NULL,
    "channelId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "downloads" BOOLEAN NOT NULL DEFAULT true,
    "recommendations" BOOLEAN NOT NULL DEFAULT false,
    "account" BOOLEAN NOT NULL DEFAULT true,
    "updates" BOOLEAN NOT NULL DEFAULT true,
    "security" BOOLEAN NOT NULL DEFAULT true,
    "playbackEvents" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playback" JSONB NOT NULL DEFAULT '{}',
    "downloads" JSONB NOT NULL DEFAULT '{}',
    "lyrics" JSONB NOT NULL DEFAULT '{}',
    "appearance" JSONB NOT NULL DEFAULT '{}',
    "privacy" JSONB NOT NULL DEFAULT '{}',
    "security" JSONB NOT NULL DEFAULT '{}',
    "dataSaver" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "trackIds" JSONB NOT NULL,
    "seed" JSONB,
    "reason" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderStatus" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "healthy" BOOLEAN NOT NULL DEFAULT true,
    "lastHealthCheck" TIMESTAMP(3),
    "successRate" DOUBLE PRECISION,
    "avgLatencyMs" INTEGER,
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "totalFailures" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "circuitOpen" BOOLEAN NOT NULL DEFAULT false,
    "circuitOpenedAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "operation" TEXT,
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipHash" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "percentage" DOUBLE PRECISION,
    "userSegment" JSONB,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_roleId_action_key" ON "Permission"("roleId", "action");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_deviceId_idx" ON "Session"("deviceId");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE INDEX "Device_pushToken_idx" ON "Device"("pushToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_tokenHash_key" ON "VerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "VerificationToken_userId_kind_idx" ON "VerificationToken"("userId", "kind");

-- CreateIndex
CREATE INDEX "VerificationToken_expiresAt_idx" ON "VerificationToken"("expiresAt");

-- CreateIndex
CREATE INDEX "VerificationToken_tokenHash_idx" ON "VerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "Artist_name_idx" ON "Artist"("name");

-- CreateIndex
CREATE INDEX "Artist_normalizedName_idx" ON "Artist"("normalizedName");

-- CreateIndex
CREATE INDEX "ArtistsExternalIds_provider_externalId_idx" ON "ArtistsExternalIds"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistsExternalIds_artistId_provider_externalId_key" ON "ArtistsExternalIds"("artistId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "ArtistGenre_genre_idx" ON "ArtistGenre"("genre");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistGenre_artistId_genre_key" ON "ArtistGenre"("artistId", "genre");

-- CreateIndex
CREATE INDEX "Album_title_idx" ON "Album"("title");

-- CreateIndex
CREATE INDEX "Album_normalizedTitle_idx" ON "Album"("normalizedTitle");

-- CreateIndex
CREATE INDEX "Album_artistId_idx" ON "Album"("artistId");

-- CreateIndex
CREATE INDEX "Album_releaseDate_idx" ON "Album"("releaseDate");

-- CreateIndex
CREATE INDEX "AlbumsExternalIds_provider_externalId_idx" ON "AlbumsExternalIds"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "AlbumsExternalIds_albumId_provider_externalId_key" ON "AlbumsExternalIds"("albumId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "Track_title_idx" ON "Track"("title");

-- CreateIndex
CREATE INDEX "Track_normalizedTitle_idx" ON "Track"("normalizedTitle");

-- CreateIndex
CREATE INDEX "Track_isrc_idx" ON "Track"("isrc");

-- CreateIndex
CREATE INDEX "Track_isrcNormalized_idx" ON "Track"("isrcNormalized");

-- CreateIndex
CREATE INDEX "Track_albumId_idx" ON "Track"("albumId");

-- CreateIndex
CREATE INDEX "Track_durationMs_idx" ON "Track"("durationMs");

-- CreateIndex
CREATE INDEX "TrackArtist_artistId_idx" ON "TrackArtist"("artistId");

-- CreateIndex
CREATE INDEX "TrackArtist_trackId_idx" ON "TrackArtist"("trackId");

-- CreateIndex
CREATE INDEX "TracksExternalIds_provider_externalId_idx" ON "TracksExternalIds"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "TracksExternalIds_trackId_provider_externalId_key" ON "TracksExternalIds"("trackId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "TrackSource_trackId_provider_idx" ON "TrackSource"("trackId", "provider");

-- CreateIndex
CREATE INDEX "TrackSource_provider_available_idx" ON "TrackSource"("provider", "available");

-- CreateIndex
CREATE INDEX "Playlist_ownerId_idx" ON "Playlist"("ownerId");

-- CreateIndex
CREATE INDEX "Playlist_visibility_updatedAt_idx" ON "Playlist"("visibility", "updatedAt");

-- CreateIndex
CREATE INDEX "Playlist_title_idx" ON "Playlist"("title");

-- CreateIndex
CREATE INDEX "PlaylistTrack_trackId_idx" ON "PlaylistTrack"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistTrack_playlistId_trackId_key" ON "PlaylistTrack"("playlistId", "trackId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistTrack_playlistId_position_key" ON "PlaylistTrack"("playlistId", "position");

-- CreateIndex
CREATE INDEX "PlaylistCollaborator_userId_idx" ON "PlaylistCollaborator"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistCollaborator_playlistId_userId_key" ON "PlaylistCollaborator"("playlistId", "userId");

-- CreateIndex
CREATE INDEX "Favorite_entityType_entityId_idx" ON "Favorite"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Favorite_userId_createdAt_idx" ON "Favorite"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_entityType_entityId_key" ON "Favorite"("userId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "PlayHistory_userId_playedAt_idx" ON "PlayHistory"("userId", "playedAt");

-- CreateIndex
CREATE INDEX "PlayHistory_trackId_playedAt_idx" ON "PlayHistory"("trackId", "playedAt");

-- CreateIndex
CREATE INDEX "PlayHistory_userId_completed_idx" ON "PlayHistory"("userId", "completed");

-- CreateIndex
CREATE INDEX "PlayHistory_userId_completionPct_idx" ON "PlayHistory"("userId", "completionPct");

-- CreateIndex
CREATE UNIQUE INDEX "ListeningStats_userId_key" ON "ListeningStats"("userId");

-- CreateIndex
CREATE INDEX "ListeningStats_lastCalculatedAt_idx" ON "ListeningStats"("lastCalculatedAt");

-- CreateIndex
CREATE INDEX "Download_userId_status_idx" ON "Download"("userId", "status");

-- CreateIndex
CREATE INDEX "Download_trackId_idx" ON "Download"("trackId");

-- CreateIndex
CREATE INDEX "Download_batchId_idx" ON "Download"("batchId");

-- CreateIndex
CREATE INDEX "Download_createdAt_idx" ON "Download"("createdAt");

-- CreateIndex
CREATE INDEX "DownloadBatch_userId_status_idx" ON "DownloadBatch"("userId", "status");

-- CreateIndex
CREATE INDEX "DownloadEvent_downloadId_createdAt_idx" ON "DownloadEvent"("downloadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lyrics_trackId_key" ON "Lyrics"("trackId");

-- CreateIndex
CREATE INDEX "Lyrics_provider_idx" ON "Lyrics"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "LyricsVersion_lyricsId_provider_key" ON "LyricsVersion"("lyricsId", "provider");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreferences_userId_key" ON "NotificationPreferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "Recommendation_userId_kind_idx" ON "Recommendation"("userId", "kind");

-- CreateIndex
CREATE INDEX "Recommendation_userId_expiresAt_idx" ON "Recommendation"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderStatus_provider_key" ON "ProviderStatus"("provider");

-- CreateIndex
CREATE INDEX "ProviderEvent_provider_createdAt_idx" ON "ProviderEvent"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderEvent_eventType_createdAt_idx" ON "ProviderEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "AdminLog_actorId_idx" ON "AdminLog"("actorId");

-- CreateIndex
CREATE INDEX "AdminLog_action_idx" ON "AdminLog"("action");

-- CreateIndex
CREATE INDEX "AdminLog_targetType_targetId_idx" ON "AdminLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AdminLog_createdAt_idx" ON "AdminLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistsExternalIds" ADD CONSTRAINT "ArtistsExternalIds_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistGenre" ADD CONSTRAINT "ArtistGenre_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumsExternalIds" ADD CONSTRAINT "AlbumsExternalIds_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackArtist" ADD CONSTRAINT "TrackArtist_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackArtist" ADD CONSTRAINT "TrackArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TracksExternalIds" ADD CONSTRAINT "TracksExternalIds_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackSource" ADD CONSTRAINT "TrackSource_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistTrack" ADD CONSTRAINT "PlaylistTrack_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistTrack" ADD CONSTRAINT "PlaylistTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistCollaborator" ADD CONSTRAINT "PlaylistCollaborator_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayHistory" ADD CONSTRAINT "PlayHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayHistory" ADD CONSTRAINT "PlayHistory_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListeningStats" ADD CONSTRAINT "ListeningStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DownloadBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lyrics" ADD CONSTRAINT "Lyrics_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LyricsVersion" ADD CONSTRAINT "LyricsVersion_lyricsId_fkey" FOREIGN KEY ("lyricsId") REFERENCES "Lyrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreferences" ADD CONSTRAINT "NotificationPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminLog" ADD CONSTRAINT "AdminLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

