import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import type { CanonicalTrack, UserRole } from '@sinc/shared';
import { ConflictError, NotFoundError } from '@sinc/shared';
import { prisma } from '../../lib/prisma.js';
import { toCanonicalUser } from '../auth/serializers.js';
import type { DownloadsService } from '../downloads/service.js';

export type AdminAction =
  | 'user.promote'
  | 'user.demote'
  | 'user.suspend'
  | 'user.unsuspend'
  | 'user.delete'
  | 'user.reset_password'
  | 'session.revoke'
  | 'playlist.delete'
  | 'device.revoke'
  | 'download.retry'
  | 'download.cancel';

export interface AdminUserRow {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  role: UserRole;
  status: 'active' | 'suspended';
  createdAt: string;
  lastLoginAt?: string;
  sessionCount: number;
}

interface AuditInput {
  actorId: string;
  action: AdminAction;
  targetType: string;
  targetId?: string;
  details?: unknown;
  ip?: string;
}

/** Tiny TTL memo for the admin dashboards: these aggregates scan large tables
 *  and only need minute-level freshness. */
const statsCache = new Map<string, { value: unknown; expiresAt: number }>();
async function cachedStats<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = statsCache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.value as T;
  const value = await compute();
  statsCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** Day-bucketed counts computed SQL-side (date_trunc) instead of shipping one
 *  row per timestamp to JS. Table/column pairs are validated against this
 *  allowlist before any raw SQL is assembled. */
interface DayCountRow {
  day: Date;
  count: bigint;
}

const DAY_COUNT_SOURCES = {
  User: 'createdAt',
  History: 'playedAt',
  DownloadJob: 'createdAt',
  Session: 'createdAt',
} as const;

async function countsPerDay(
  table: keyof typeof DAY_COUNT_SOURCES,
  since: Date
): Promise<Map<string, number>> {
  const column = DAY_COUNT_SOURCES[table];
  const rows = await prisma.$queryRaw<DayCountRow[]>(
    Prisma.sql`SELECT date_trunc('day', ${Prisma.raw(`"${column}"`)}) AS day, count(*) AS count
       FROM ${Prisma.raw(`"${table}"`)}
      WHERE ${Prisma.raw(`"${column}"`)} >= ${since}
      GROUP BY 1`
  );
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.day.toISOString().slice(0, 10), Number(row.count));
  }
  return map;
}

async function activeUsersPerDay(since: Date): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<DayCountRow[]>(
    Prisma.sql`SELECT date_trunc('day', "playedAt") AS day, count(DISTINCT "userId") AS count
       FROM "History"
      WHERE "playedAt" >= ${since}
      GROUP BY 1`
  );
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.day.toISOString().slice(0, 10), Number(row.count));
  }
  return map;
}

export class AdminService {
  constructor(private readonly downloads?: DownloadsService) {}

  /** Writes an audit row for an admin action (called by every mutating method). */
  private async audit(input: AuditInput): Promise<void> {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        details: (input.details as object | null) ?? undefined,
        ipAddress: input.ip ?? null,
      },
    });
  }

  private async requireTarget(
    id: string,
    resource = 'User'
  ): Promise<{ id: string; role: string }> {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!user) throw new NotFoundError(resource);
    return user;
  }

  private async guardSelf(actorId: string, targetId: string, action: string): Promise<void> {
    if (actorId === targetId) {
      throw new ConflictError(`Admins cannot ${action} their own account`);
    }
  }

  // ---- Users -------------------------------------------------------------

  async listUsers(
    page: number,
    limit: number,
    opts: {
      query?: string;
      role?: 'user' | 'admin';
      status?: 'active' | 'suspended';
      sort?: 'createdAt' | 'lastLoginAt';
    } = {}
  ): Promise<{ users: AdminUserRow[]; total: number }> {
    const where: Prisma.UserWhereInput = {};
    if (opts.query) {
      where.OR = [
        { email: { contains: opts.query, mode: 'insensitive' as const } },
        { username: { contains: opts.query, mode: 'insensitive' as const } },
        { displayName: { contains: opts.query, mode: 'insensitive' as const } },
      ];
    }
    if (opts.role) where.role = opts.role;
    if (opts.status) where.status = opts.status;
    const orderBy: Prisma.UserOrderByWithRelationInput =
      opts.sort === 'lastLoginAt' ? { lastLoginAt: 'desc' } : { createdAt: 'desc' };

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          role: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
          _count: { select: { sessions: true } },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users: rows.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        displayName: u.displayName ?? undefined,
        avatarUrl: u.avatarUrl ?? undefined,
        role: (u.role as UserRole) ?? 'user',
        status: (u.status as 'active' | 'suspended') ?? 'active',
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString(),
        sessionCount: u._count.sessions,
      })),
      total,
    };
  }

  async getUser(id: string): Promise<{ user: ReturnType<typeof toCanonicalUser> }> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError('User');
    return { user: toCanonicalUser(user) };
  }

  async promote(actorId: string, targetId: string, ip?: string): Promise<void> {
    await this.guardSelf(actorId, targetId, 'promote');
    await this.requireTarget(targetId);
    await prisma.user.update({ where: { id: targetId }, data: { role: 'admin' } });
    await this.audit({ actorId, action: 'user.promote', targetType: 'user', targetId, ip });
  }

  async demote(actorId: string, targetId: string, ip?: string): Promise<void> {
    await this.guardSelf(actorId, targetId, 'demote');
    await this.requireTarget(targetId);
    await prisma.user.update({ where: { id: targetId }, data: { role: 'user' } });
    await this.audit({ actorId, action: 'user.demote', targetType: 'user', targetId, ip });
  }

  async suspend(actorId: string, targetId: string, ip?: string): Promise<void> {
    await this.guardSelf(actorId, targetId, 'suspend');
    await this.requireTarget(targetId);
    await prisma.user.update({ where: { id: targetId }, data: { status: 'suspended' } });
    await this.audit({ actorId, action: 'user.suspend', targetType: 'user', targetId, ip });
  }

  async unsuspend(actorId: string, targetId: string, ip?: string): Promise<void> {
    await this.guardSelf(actorId, targetId, 'unsuspend');
    await this.requireTarget(targetId);
    await prisma.user.update({ where: { id: targetId }, data: { status: 'active' } });
    await this.audit({ actorId, action: 'user.unsuspend', targetType: 'user', targetId, ip });
  }

  async deleteUser(actorId: string, targetId: string, ip?: string): Promise<void> {
    await this.guardSelf(actorId, targetId, 'delete');
    await this.requireTarget(targetId);
    await prisma.user.delete({ where: { id: targetId } });
    await this.audit({ actorId, action: 'user.delete', targetType: 'user', targetId, ip });
  }

  /** Issues a one-time password-reset token for a user (returned to the admin). */
  async forceReset(actorId: string, targetId: string, ip?: string): Promise<{ token: string }> {
    await this.requireTarget(targetId);
    const token = randomUUID();
    await prisma.verificationToken.create({
      data: {
        userId: targetId,
        token,
        type: 'password_reset',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    await this.audit({ actorId, action: 'user.reset_password', targetType: 'user', targetId, ip });
    return { token };
  }

  // ---- Sessions ----------------------------------------------------------

  async listSessions(userId: string): Promise<{
    sessions: Array<{
      id: string;
      userAgent?: string;
      ipAddress?: string;
      createdAt: string;
      expiresAt: string;
      revokedAt?: string;
    }>;
  }> {
    await this.requireTarget(userId);
    const sessions = await prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent ?? undefined,
        ipAddress: s.ipAddress ?? undefined,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        revokedAt: s.revokedAt?.toISOString(),
      })),
    };
  }

  async revokeSession(actorId: string, sessionId: string, ip?: string): Promise<void> {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true },
    });
    if (!session) throw new NotFoundError('Session');
    await prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit({
      actorId,
      action: 'session.revoke',
      targetType: 'session',
      targetId: sessionId,
      details: { userId: session.userId },
      ip,
    });
  }

  // ---- Playlists ---------------------------------------------------------

  async listPlaylists(
    page: number,
    limit: number,
    query?: string
  ): Promise<{
    playlists: Array<{
      id: string;
      name: string;
      trackCount: number;
      userId: string;
      createdAt: string;
    }>;
    total: number;
  }> {
    const where = query ? { name: { contains: query, mode: 'insensitive' as const } } : undefined;
    const [rows, total] = await Promise.all([
      prisma.playlist.findMany({
        where,
        select: { id: true, name: true, trackCount: true, userId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.playlist.count({ where }),
    ]);
    return {
      playlists: rows.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
      total,
    };
  }

  async deletePlaylist(actorId: string, playlistId: string, ip?: string): Promise<void> {
    const playlist = await prisma.playlist.findUnique({
      where: { id: playlistId },
      select: { id: true },
    });
    if (!playlist) throw new NotFoundError('Playlist');
    await prisma.playlist.delete({ where: { id: playlistId } });
    await this.audit({
      actorId,
      action: 'playlist.delete',
      targetType: 'playlist',
      targetId: playlistId,
      ip,
    });
  }

  // ---- Stats -------------------------------------------------------------

  async statsOverview(): Promise<{
    users: number;
    suspendedUsers: number;
    admins: number;
    activeSessions: number;
    visitsTotal: number;
    playlists: number;
    favorites: number;
    historyRows: number;
    downloads: number;
    completedDownloads: number;
    lyricsCached: number;
  }> {
    return cachedStats('admin:stats:overview', 60_000, async () => {
      const [
        users,
        suspendedUsers,
        admins,
        activeSessions,
        visitsTotal,
        playlists,
        favorites,
        historyRows,
        downloads,
        completedDownloads,
        lyricsCached,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { status: 'suspended' } }),
        prisma.user.count({ where: { role: 'admin' } }),
        prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
        prisma.session.count(),
        prisma.playlist.count(),
        prisma.favorite.count(),
        prisma.history.count(),
        prisma.downloadJob.count(),
        prisma.downloadJob.count({ where: { status: 'completed' } }),
        prisma.lyric.count(),
      ]);
      return {
        users,
        suspendedUsers,
        admins,
        activeSessions,
        visitsTotal,
        playlists,
        favorites,
        historyRows,
        downloads,
        completedDownloads,
        lyricsCached,
      };
    });
  }

  async statsActivity(days: number): Promise<
    Array<{
      day: string;
      signups: number;
      plays: number;
      downloads: number;
      visits: number;
      activeUsers: number;
    }>
  > {
    return cachedStats(`admin:stats:activity:${days}`, 60_000, async () => {
      const since = new Date(Date.now() - days * 24 * 3600 * 1000);
      const dayOf = (date: Date) => date.toISOString().slice(0, 10);
      const map = new Map<
        string,
        {
          day: string;
          signups: number;
          plays: number;
          downloads: number;
          visits: number;
          activeUsers: number;
        }
      >();
      for (let i = days - 1; i >= 0; i -= 1) {
        const d = new Date(Date.now() - i * 24 * 3600 * 1000);
        map.set(dayOf(d), {
          day: dayOf(d),
          signups: 0,
          plays: 0,
          downloads: 0,
          visits: 0,
          activeUsers: 0,
        });
      }

      // Day buckets are aggregated SQL-side (date_trunc + count), so each
      // query returns at most one row per day instead of one per timestamp.
      const [signups, plays, downloads, visits, activeUsers] = await Promise.all([
        countsPerDay('User', since),
        countsPerDay('History', since),
        countsPerDay('DownloadJob', since),
        countsPerDay('Session', since),
        activeUsersPerDay(since),
      ]);

      for (const [day, count] of signups) {
        const entry = map.get(day);
        if (entry) entry.signups += count;
      }
      for (const [day, count] of plays) {
        const entry = map.get(day);
        if (entry) entry.plays += count;
      }
      for (const [day, count] of downloads) {
        const entry = map.get(day);
        if (entry) entry.downloads += count;
      }
      for (const [day, count] of visits) {
        const entry = map.get(day);
        if (entry) entry.visits += count;
      }
      for (const [day, count] of activeUsers) {
        const entry = map.get(day);
        if (entry) entry.activeUsers += count;
      }
      return [...map.values()];
    });
  }

  /** Most-played tracks and artists (all time). Aggregated and ranked in SQL
   *  so only the top rows leave the database. */
  async statsTop(limit = 10): Promise<{
    tracks: Array<{ trackId: string; title: string; artist?: string; plays: number }>;
    artists: Array<{ name: string; plays: number }>;
  }> {
    return cachedStats(`admin:stats:top:${limit}`, 60_000, async () => {
      const take = Math.min(limit, 25);
      const trackRows = await prisma.$queryRaw<
        Array<{ trackId: string; title: string | null; artist: string | null; plays: bigint }>
      >(Prisma.sql`SELECT "trackId" AS "trackId",
             MAX("trackTitle") AS title,
             MAX("trackArtist") AS artist,
             count(*) AS plays
        FROM "History"
       GROUP BY "trackId"
       ORDER BY plays DESC
       LIMIT ${take}`);
      const artistRows = await prisma.$queryRaw<
        Array<{ name: string | null; plays: bigint }>
      >(Prisma.sql`SELECT "trackArtist" AS name, count(*) AS plays
        FROM "History"
       WHERE "trackArtist" IS NOT NULL
       GROUP BY "trackArtist"
       ORDER BY plays DESC
       LIMIT ${take}`);
      return {
        tracks: trackRows.map((r) => ({
          trackId: r.trackId,
          title: r.title ?? r.trackId,
          artist: r.artist ?? undefined,
          plays: Number(r.plays),
        })),
        artists: artistRows.map((r) => ({ name: r.name ?? 'Unknown', plays: Number(r.plays) })),
      };
    });
  }

  // ---- Audit -------------------------------------------------------------

  async listAudit(
    page: number,
    limit: number,
    action?: string
  ): Promise<{
    entries: Array<{
      id: string;
      actorId: string;
      action: string;
      targetType: string;
      targetId?: string;
      ipAddress?: string;
      createdAt: string;
    }>;
    total: number;
  }> {
    const where = action ? { action: { startsWith: action } } : undefined;
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);
    return {
      entries: rows.map((e) => ({
        id: e.id,
        actorId: e.actorId,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId ?? undefined,
        ipAddress: e.ipAddress ?? undefined,
        createdAt: e.createdAt.toISOString(),
      })),
      total,
    };
  }

  // ---- Downloads monitoring ---------------------------------------------

  async listDownloads(
    page: number,
    limit: number,
    opts: { status?: string; query?: string; userId?: string } = {}
  ): Promise<{
    jobs: Array<{
      id: string;
      userId: string;
      trackTitle: string;
      trackArtist: string;
      status: string;
      progress: number;
      provider?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      createdAt: string;
      completedAt?: string | null;
    }>;
    total: number;
  }> {
    const statuses = ['pending', 'downloading', 'paused', 'completed', 'failed', 'cancelled'];
    const status = statuses.includes(opts.status ?? '') ? opts.status : undefined;

    const where: Prisma.DownloadJobWhereInput = {};
    if (status) where.status = status;
    if (opts.userId) where.userId = opts.userId;
    if (opts.query) {
      where.OR = [
        { trackTitle: { contains: opts.query, mode: 'insensitive' as const } },
        { trackArtist: { contains: opts.query, mode: 'insensitive' as const } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.downloadJob.findMany({
        where,
        select: {
          id: true,
          userId: true,
          trackTitle: true,
          trackArtist: true,
          status: true,
          progress: true,
          provider: true,
          errorCode: true,
          errorMessage: true,
          createdAt: true,
          completedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.downloadJob.count({ where }),
    ]);

    return {
      jobs: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        trackTitle: r.trackTitle,
        trackArtist: r.trackArtist,
        status: r.status,
        progress: r.progress,
        provider: r.provider,
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
      total,
    };
  }

  async downloadStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    completed: number;
    failed: number;
    successRate: number | null;
  }> {
    return cachedStats('admin:downloads:stats', 60_000, async () => {
      const statuses = ['pending', 'downloading', 'paused', 'completed', 'failed', 'cancelled'];
      const counts = await Promise.all(
        statuses.map((s) => prisma.downloadJob.count({ where: { status: s } }))
      );
      const byStatus: Record<string, number> = {};
      statuses.forEach((s, i) => {
        byStatus[s] = counts[i];
      });
      const completed = byStatus.completed;
      const failed = byStatus.failed;
      const finished = completed + failed;
      return {
        total: counts.reduce((a, b) => a + b, 0),
        byStatus,
        completed,
        failed,
        successRate: finished > 0 ? (completed / finished) * 100 : null,
      };
    });
  }

  async retryDownload(actorId: string, jobId: string): Promise<{ ok: boolean }> {
    const job = await prisma.downloadJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundError('Download');
    if (job.status === 'downloading') return { ok: true };
    await prisma.downloadJob.update({
      where: { id: jobId },
      data: { status: 'failed', errorMessage: 'Marked for retry by admin' },
    });
    await this.audit({
      actorId,
      action: 'download.retry',
      targetType: 'download',
      targetId: jobId,
      details: { trackTitle: job.trackTitle, status: job.status },
    });

    if (this.downloads) {
      const track: CanonicalTrack = {
        id: job.trackId,
        title: job.trackTitle,
        artists: [
          {
            id: `admin:${job.userId}`,
            name: job.trackArtist ?? 'Unknown Artist',
            providerIds: {},
            genres: [],
          },
        ],
        providerIds: {},
        durationMs: 0,
        explicit: false,
      };
      void this.downloads.startDownload(job.userId, track).catch(() => undefined);
    }
    return { ok: true };
  }

  async cancelDownload(actorId: string, jobId: string): Promise<{ ok: boolean }> {
    const job = await prisma.downloadJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundError('Download');
    await prisma.downloadJob.update({
      where: { id: jobId },
      data: { status: 'cancelled', errorMessage: 'Cancelled by admin' },
    });
    await this.audit({
      actorId,
      action: 'download.cancel',
      targetType: 'download',
      targetId: jobId,
      details: { trackTitle: job.trackTitle },
    });
    return { ok: true };
  }

  // ---- Devices -----------------------------------------------------------

  async listDevices(userId?: string): Promise<{
    devices: Array<{
      id: string;
      userId: string;
      name: string;
      platform: string;
      lastSeenAt: string;
      createdAt: string;
    }>;
    total: number;
  }> {
    const where = userId ? { userId } : undefined;
    const [rows, total] = await Promise.all([
      prisma.device.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        take: 200,
      }),
      prisma.device.count({ where }),
    ]);
    return {
      devices: rows.map((d) => ({
        id: d.id,
        userId: d.userId,
        name: d.name,
        platform: d.platform,
        lastSeenAt: d.lastSeenAt.toISOString(),
        createdAt: d.createdAt.toISOString(),
      })),
      total,
    };
  }

  async revokeDevice(actorId: string, deviceId: string): Promise<{ ok: boolean }> {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundError('Device');
    await prisma.device.delete({ where: { id: deviceId } });
    await this.audit({
      actorId,
      action: 'device.revoke',
      targetType: 'device',
      targetId: deviceId,
      details: { name: device.name, platform: device.platform },
    });
    return { ok: true };
  }

  // ---- User detail -------------------------------------------------------

  async userDetail(userId: string): Promise<{
    user: ReturnType<typeof toCanonicalUser>;
    emailVerified: boolean;
    sessionCount: number;
    devices: number;
    favorites: number;
    playlists: number;
    downloads: number;
    completedDownloads: number;
    historyCount: number;
    totalPlays: number;
  }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User');
    const [sessionCount, devices, favorites, playlists, downloads, completedDownloads, historyAgg] =
      await Promise.all([
        prisma.session.count({ where: { userId } }),
        prisma.device.count({ where: { userId } }),
        prisma.favorite.count({ where: { userId } }),
        prisma.playlist.count({ where: { userId } }),
        prisma.downloadJob.count({ where: { userId } }),
        prisma.downloadJob.count({ where: { userId, status: 'completed' } }),
        prisma.history.groupBy({ by: ['userId'], where: { userId }, _count: { _all: true } }),
      ]);
    return {
      user: toCanonicalUser(user),
      emailVerified: user.emailVerified,
      sessionCount,
      devices,
      favorites,
      playlists,
      downloads,
      completedDownloads,
      historyCount: historyAgg[0]?._count._all ?? 0,
      totalPlays: historyAgg[0]?._count._all ?? 0,
    };
  }

  // ---- System / health ---------------------------------------------------

  async systemHealth(): Promise<{
    uptimeSec: number;
    nodeVersion: string;
    platform: string;
    arch: string;
    cpuCores: number;
    memory: { total: number; free: number; used: number };
    downloadsDir: {
      path: string;
      usedBytes: number | null;
      fileCount: number;
      aversions: Record<string, number>;
    };
    dbStatus: 'ok' | 'error';
  }> {
    const downloadDir = process.env.DOWNLOAD_DIR ?? './downloads';
    let usedBytes: number | null = null;
    let fileCount = 0;
    const aversions: Record<string, number> = {};
    try {
      const entries = await fs.readdir(downloadDir, { withFileTypes: true });
      const files = entries.filter((e) => e.isFile());
      fileCount = files.length;
      let total = 0;
      const counts: Record<string, number> = {};
      for (const f of files) {
        try {
          const s = await fs.stat(path.join(downloadDir, f.name));
          total += s.size;
          const ext = path.extname(f.name).toLowerCase() || 'none';
          counts[ext] = (counts[ext] ?? 0) + 1;
        } catch {
          /* skip */
        }
      }
      usedBytes = total;
      Object.assign(aversions, counts);
    } catch {
      usedBytes = null;
    }

    let dbStatus: 'ok' | 'error' = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    const mem = process.memoryUsage();

    return {
      uptimeSec: Math.round(process.uptime()),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCores: os.availableParallelism?.() ?? os.cpus().length,
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: mem.rss,
      },
      downloadsDir: {
        path: downloadDir,
        usedBytes,
        fileCount,
        aversions,
      },
      dbStatus,
    };
  }

  async cacheSizes(): Promise<{
    searchCacheRows: number;
    searchCacheBytes: number | null;
    lyrics: number;
  }> {
    return cachedStats('admin:caches', 60_000, async () => {
      const [searchCacheRows, lyrics] = await Promise.all([
        prisma.searchCache.count(),
        prisma.lyric.count(),
      ]);
      return { searchCacheRows, searchCacheBytes: null, lyrics };
    });
  }

  // ---- Reliability analytics ---------------------------------------------

  async reliabilityOverview(days = 30): Promise<{
    events: Record<string, number>;
    totals: {
      searches: number;
      playbackStarts: number;
      playbackCompletes: number;
      downloadsCompleted: number;
      lyricsMatched: number;
    };
    rates: {
      playbackCompletionRate: number | null;
      downloadCompletionRate: number | null;
      lyricsMatchRate: number | null;
    };
  }> {
    return cachedStats(`admin:reliability:${days}`, 60_000, async () => {
      const since = new Date(Date.now() - days * 24 * 3600 * 1000);
      const rows = await prisma.analyticsEvent.groupBy({
        by: ['event'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      });
      const events: Record<string, number> = {};
      for (const r of rows) {
        events[r.event] = r._count._all;
      }

      const searches = events['search:success'] ?? 0;
      const playbackStarts = events['playback:start'] ?? 0;
      const playbackCompletes = events['playback:complete'] ?? 0;
      const downloadsCompleted = events['download:complete'] ?? 0;
      const lyricsMatched = events['lyrics:matched'] ?? 0;

      const ratio = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);

      const downloadRate =
        downloadsCompleted + searches > 0 ? ratio(downloadsCompleted, searches) : null;

      return {
        events,
        totals: {
          searches,
          playbackStarts,
          playbackCompletes,
          downloadsCompleted,
          lyricsMatched,
        },
        rates: {
          playbackCompletionRate: ratio(playbackCompletes, playbackStarts),
          downloadCompletionRate: downloadRate,
          lyricsMatchRate: ratio(lyricsMatched, searches),
        },
      };
    });
  }
}
