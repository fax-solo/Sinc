/**
 * M6 signal collection. The mobile app records plays and favorites locally;
 * these endpoints upsert that signal into the server so the personalized
 * home feed has real data to work with. Both are best-effort writes that must
 * never throw on missing/extra fields.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../lib/prisma.js';
import {
  type ListeningEvent,
  type MusicTasteProfile,
  computeUserTasteProfile,
} from '@sinc/shared';

const HISTORY_CAP = 500;

export interface PlayInput {
  trackId: string;
  trackTitle?: string | null;
  trackArtist?: string | null;
  trackAlbum?: string | null;
  trackArtwork?: string | null;
  durationMs?: number | null;
}

export interface FavoriteTrackInput {
  trackId: string;
  trackTitle?: string | null;
  trackSubtitle?: string | null;
}

/**
 * A collection the user started playing (a Daily Mix, album or playlist). It is
 * recorded as a synthetic history row (`mix:...`/`album:...`/`playlist:...`) so
 * it surfaces in "Recently played" with its artwork and name instead of a song
 * from it — the same trick Spotify uses for its recents.
 */
export interface CollectionPlayInput {
  itemId: string;
  itemType: 'mix' | 'album' | 'playlist';
  title: string;
  subtitle?: string | null;
  artworkUrl?: string | null;
}

type SignalDb = Pick<
  PrismaClient,
  'history' | 'favorite' | 'listeningEventLog' | 'userTasteSnapshot'
>;

export class MusicSignalService {
  constructor(private readonly db: SignalDb = defaultPrisma) {}

  /**
   * Phase 1: Records a batch of listening and preference events with idempotency.
   */
  async recordListeningEvents(
    userId: string,
    events: ListeningEvent[]
  ): Promise<{ processed: number; duplicates: number }> {
    if (!Array.isArray(events) || events.length === 0) {
      return { processed: 0, duplicates: 0 };
    }

    const valid = events.filter(
      (e): e is ListeningEvent & { idempotencyId: string; sessionId: string } =>
        Boolean(
          e &&
          typeof e.idempotencyId === 'string' &&
          e.idempotencyId.length > 0 &&
          typeof e.trackId === 'string' &&
          e.trackId.length > 0 &&
          typeof e.sessionId === 'string'
        )
    );

    if (valid.length === 0) {
      return { processed: 0, duplicates: 0 };
    }

    const idempotencyIds = valid.map((e) => e.idempotencyId);
    const existing = await this.db.listeningEventLog.findMany({
      where: { idempotencyId: { in: idempotencyIds } },
      select: { idempotencyId: true },
    });
    const existingSet = new Set(existing.map((e) => e.idempotencyId));
    const newEvents = valid.filter((e) => !existingSet.has(e.idempotencyId));

    if (newEvents.length > 0) {
      await this.db.listeningEventLog.createMany({
        data: newEvents.map((ev) => ({
          id: randomUUID(),
          idempotencyId: ev.idempotencyId,
          userId,
          sessionId: ev.sessionId,
          trackId: ev.trackId,
          trackTitle: ev.trackTitle ?? 'Unknown Track',
          artistId: ev.artistId ?? null,
          artistName: ev.artistName ?? 'Unknown Artist',
          albumId: ev.albumId ?? null,
          albumTitle: ev.albumTitle ?? null,
          genres: Array.isArray(ev.genres) ? ev.genres : [],
          eventType: ev.eventType,
          playbackPositionMs: Math.round(ev.positionMs ?? 0),
          listenDurationMs: Math.round(ev.playbackDurationMs ?? 0),
          trackDurationMs: Math.round(ev.trackDurationMs ?? 0),
          completionRatio: ev.completionRatio ?? 0,
          meaningfulPlay: Boolean(ev.meaningfulPlayQualified),
          playbackSource: ev.playbackSource ?? 'stream',
          timestamp: new Date(ev.timestamp ?? Date.now()),
          createdAt: new Date(),
        })),
      });

      // Invalidate user taste snapshot
      await this.db.userTasteSnapshot.deleteMany({ where: { userId } }).catch(() => undefined);

      // Backwards-compatible legacy history updates for started/completed plays
      for (const ev of newEvents) {
        if (ev.eventType === 'track_started' || ev.eventType === 'track_completed') {
          void this.recordPlay(userId, {
            trackId: ev.trackId,
            trackTitle: ev.trackTitle,
            trackArtist: ev.artistName,
            trackAlbum: ev.albumTitle,
            durationMs: ev.trackDurationMs,
          }).catch(() => undefined);
        }
      }
    }

    return {
      processed: newEvents.length,
      duplicates: valid.length - newEvents.length,
    };
  }

  /**
   * Phase 1: Returns paginated listening events for a user with strict user-level isolation.
   */
  async getListeningEvents(
    userId: string,
    options: { page?: number; limit?: number; eventType?: string } = {}
  ): Promise<{ data: any[]; total: number }> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (options.eventType) {
      where.eventType = options.eventType;
    }

    const [data, total] = await Promise.all([
      this.db.listeningEventLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { timestamp: 'desc' },
      }),
      this.db.listeningEventLog.count({ where }),
    ]);

    return { data, total };
  }

  /**
   * Phase 1: Deletes all listening event history, taste snapshot, and legacy history (GDPR erasure).
   */
  async deleteListeningHistory(userId: string): Promise<{ deleted: number }> {
    const [delLog] = await Promise.all([
      this.db.listeningEventLog.deleteMany({ where: { userId } }),
      this.db.history.deleteMany({ where: { userId } }),
      this.db.userTasteSnapshot.deleteMany({ where: { userId } }),
    ]);

    return { deleted: delLog.count };
  }

  /**
   * Phase 1: Retrieves user taste profile, returning cached snapshot or dynamically computing it.
   */
  async getUserTasteProfile(userId: string): Promise<MusicTasteProfile> {
    const snapshot = await this.db.userTasteSnapshot.findUnique({
      where: { userId },
    });

    if (snapshot?.profile && typeof snapshot.profile === 'object') {
      const p = snapshot.profile as unknown as MusicTasteProfile;
      if (p.lastUpdated) {
        return p;
      }
    }

    return this.recomputeUserTasteProfile(userId);
  }

  /**
   * Phase 1: Recomputes the user taste profile deterministically from listening history and favorites.
   */
  async recomputeUserTasteProfile(userId: string): Promise<MusicTasteProfile> {
    const [eventsData, favoritesData] = await Promise.all([
      this.db.listeningEventLog.findMany({
        where: { userId },
        orderBy: { timestamp: 'desc' },
        take: 1000,
      }),
      this.db.favorite.findMany({
        where: { userId, targetType: 'track' },
        select: { targetId: true },
      }),
    ]);

    const events: ListeningEvent[] = eventsData.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      trackId: row.trackId,
      trackTitle: row.trackTitle,
      artistId: row.artistId ?? undefined,
      artistName: row.artistName,
      albumId: row.albumId ?? undefined,
      albumTitle: row.albumTitle ?? undefined,
      genres: row.genres,
      eventType: row.eventType as ListeningEvent['eventType'],
      timestamp: row.timestamp.getTime(),
      positionMs: row.playbackPositionMs,
      playbackDurationMs: row.listenDurationMs,
      trackDurationMs: row.trackDurationMs,
      completionRatio: row.completionRatio,
      meaningfulPlayQualified: row.meaningfulPlay,
      playbackSource: row.playbackSource,
      idempotencyId: row.idempotencyId,
    }));

    const profile = computeUserTasteProfile({
      userId,
      events,
      nowMs: Date.now(),
    });

    await this.db.userTasteSnapshot.upsert({
      where: { userId },
      create: {
        id: randomUUID(),
        userId,
        profile: profile as any,
        version: 1,
      },
      update: {
        profile: profile as any,
        version: 1,
      },
    });

    return profile;
  }

  /** Upserts a play row and caps the user's history to HISTORY_CAP rows. */
  async recordPlay(userId: string, input: PlayInput): Promise<void> {
    const trackId = input.trackId;
    if (!trackId) return;

    const now = new Date();
    const data = {
      trackTitle: input.trackTitle ?? null,
      trackArtist: input.trackArtist ?? null,
      trackAlbum: input.trackAlbum ?? null,
      trackArtwork: input.trackArtwork ?? null,
      durationMs: input.durationMs ?? null,
      playedAt: now,
    };

    await this.db.history.upsert({
      where: { userId_trackId: { userId, trackId } },
      create: { id: randomUUID(), userId, trackId, ...data },
      update: data,
    });

    const count = await this.db.history.count({ where: { userId } });
    if (count > HISTORY_CAP) {
      const excess = await this.db.history.findMany({
        where: { userId },
        orderBy: { playedAt: 'desc' },
        skip: HISTORY_CAP,
        select: { id: true },
      });
      if (excess.length > 0) {
        await this.db.history.deleteMany({
          where: { id: { in: excess.map((row) => row.id) } },
        });
      }
    }
  }

  /** Replaces the user's favorited tracks with the provided list (idempotent). */
  async syncFavorites(userId: string, tracks: FavoriteTrackInput[]): Promise<void> {
    const valid = tracks.filter((t) => typeof t.trackId === 'string' && t.trackId.length > 0);
    await this.db.favorite.deleteMany({ where: { userId, targetType: 'track' } });
    if (valid.length === 0) return;
    await this.db.favorite.createMany({
      data: valid.map((t) => ({
        id: randomUUID(),
        userId,
        targetType: 'track',
        targetId: t.trackId,
        targetTitle: t.trackTitle ?? null,
        targetSubtitle: t.trackSubtitle ?? null,
        createdAt: new Date(),
      })),
    });
  }

  /** Records a collection start (mix/album/playlist) as a synthetic history row. */
  async recordCollectionPlay(userId: string, input: CollectionPlayInput): Promise<void> {
    if (!input.itemId || !input.title) return;
    await this.recordPlay(userId, {
      trackId: `${input.itemType}:${input.itemId}`,
      trackTitle: input.title,
      trackArtist: input.subtitle ?? null,
      trackAlbum: null,
      trackArtwork: input.artworkUrl ?? null,
      durationMs: null,
    });
  }
}
