/**
 * M6 signal collection. The mobile app records plays and favorites locally;
 * these endpoints upsert that signal into the server so the personalized
 * home feed has real data to work with. Both are best-effort writes that must
 * never throw on missing/extra fields.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../lib/prisma.js';

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

type SignalDb = Pick<PrismaClient, 'history' | 'favorite'>;

export class MusicSignalService {
  constructor(private readonly db: SignalDb = defaultPrisma) {}

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
