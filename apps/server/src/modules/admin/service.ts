import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { UserRole } from '@sinc/shared';
import { AuthorizationError, ConflictError, NotFoundError } from '@sinc/shared';
import { prisma } from '../../lib/prisma.js';
import { otpauthUri, generateTotpSecret, verifyTotp } from '../../lib/totp.js';
import { toCanonicalUser } from '../auth/serializers.js';

export type AdminAction =
  | 'user.promote'
  | 'user.demote'
  | 'user.suspend'
  | 'user.unsuspend'
  | 'user.delete'
  | 'user.reset_password'
  | 'session.revoke'
  | 'playlist.delete'
  | 'mfa.enable'
  | 'mfa.disable';

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

  private async mfaFor(userId: string): Promise<{ secret: string; enabled: boolean } | null> {
    return prisma.adminMfa.findUnique({
      where: { userId },
      select: { secret: true, enabled: true },
    });
  }

  // ---- Users -------------------------------------------------------------

  async listUsers(
    page: number,
    limit: number,
    query?: string
  ): Promise<{ users: AdminUserRow[]; total: number }> {
    const where = query
      ? {
          OR: [
            { email: { contains: query, mode: 'insensitive' as const } },
            { username: { contains: query, mode: 'insensitive' as const } },
            { displayName: { contains: query, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

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
        orderBy: { createdAt: 'desc' },
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

  async statsActivity(
    days: number
  ): Promise<
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
    const where = action ? { action } : undefined;
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

  // ---- MFA ---------------------------------------------------------------

  async mfaStatus(userId: string): Promise<{ enabled: boolean }> {
    const mfa = await this.mfaFor(userId);
    return { enabled: mfa?.enabled === true };
  }

  /** Generates a fresh TOTP secret for an admin (re-enrollment invalidates the old one). */
  async mfaEnroll(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new NotFoundError('User');
    const secret = generateTotpSecret();
    await prisma.adminMfa.upsert({
      where: { userId },
      create: { userId, secret, enabled: false },
      update: { secret, enabled: false },
    });
    return { secret, otpauthUrl: otpauthUri(secret, user.email) };
  }

  async mfaVerify(userId: string, code: string, ip?: string): Promise<void> {
    const mfa = await this.mfaFor(userId);
    if (!mfa) throw new NotFoundError('MFA enrollment');
    if (!verifyTotp(mfa.secret, code)) throw new AuthorizationError('Invalid authentication code');
    await prisma.adminMfa.update({ where: { userId }, data: { enabled: true } });
    await this.audit({
      actorId: userId,
      action: 'mfa.enable',
      targetType: 'admin',
      targetId: userId,
      ip,
    });
  }

  async mfaDisable(userId: string, code: string, ip?: string): Promise<void> {
    const mfa = await this.mfaFor(userId);
    if (!mfa) throw new NotFoundError('MFA enrollment');
    if (!verifyTotp(mfa.secret, code)) throw new AuthorizationError('Invalid authentication code');
    await prisma.adminMfa.delete({ where: { userId } });
    await this.audit({
      actorId: userId,
      action: 'mfa.disable',
      targetType: 'admin',
      targetId: userId,
      ip,
    });
  }

  /** Challenge check for destructive writes: admins with MFA must send a valid code. */
  async assertMfa(actorId: string, code: string | undefined): Promise<void> {
    const mfa = await this.mfaFor(actorId);
    if (!mfa?.enabled) return;
    if (!code || !verifyTotp(mfa.secret, code)) {
      throw new AuthorizationError('A valid MFA code is required for this action');
    }
  }
}
