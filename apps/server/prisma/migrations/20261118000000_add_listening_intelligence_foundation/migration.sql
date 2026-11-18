-- CreateTable
CREATE TABLE "ListeningEventLog" (
    "id" TEXT NOT NULL,
    "idempotencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "trackTitle" TEXT NOT NULL,
    "artistId" TEXT,
    "artistName" TEXT NOT NULL,
    "albumId" TEXT,
    "albumTitle" TEXT,
    "genres" TEXT[],
    "eventType" TEXT NOT NULL,
    "playbackPositionMs" INTEGER NOT NULL DEFAULT 0,
    "listenDurationMs" INTEGER NOT NULL DEFAULT 0,
    "trackDurationMs" INTEGER NOT NULL DEFAULT 0,
    "completionRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "meaningfulPlay" BOOLEAN NOT NULL DEFAULT false,
    "playbackSource" TEXT NOT NULL DEFAULT 'stream',
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListeningEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTasteSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTasteSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ListeningEventLog_idempotencyId_key" ON "ListeningEventLog"("idempotencyId");

-- CreateIndex
CREATE INDEX "ListeningEventLog_userId_timestamp_idx" ON "ListeningEventLog"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "ListeningEventLog_userId_eventType_idx" ON "ListeningEventLog"("userId", "eventType");

-- CreateIndex
CREATE INDEX "ListeningEventLog_trackId_idx" ON "ListeningEventLog"("trackId");

-- CreateIndex
CREATE INDEX "ListeningEventLog_artistId_idx" ON "ListeningEventLog"("artistId");

-- CreateIndex
CREATE INDEX "ListeningEventLog_sessionId_idx" ON "ListeningEventLog"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTasteSnapshot_userId_key" ON "UserTasteSnapshot"("userId");

-- CreateIndex
CREATE INDEX "UserTasteSnapshot_userId_idx" ON "UserTasteSnapshot"("userId");

-- AddForeignKey
ALTER TABLE "ListeningEventLog" ADD CONSTRAINT "ListeningEventLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTasteSnapshot" ADD CONSTRAINT "UserTasteSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
