import { apiClient } from './client';
import type { CanonicalUser } from '@sinc/shared';

export interface AdminUserRow {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  createdAt: string;
  lastLoginAt?: string;
  sessionCount: number;
}

export interface AdminStatsOverview {
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
}

export interface AdminActivityDay {
  day: string;
  signups: number;
  plays: number;
  downloads: number;
  visits: number;
  activeUsers: number;
}

export interface AdminTopStats {
  tracks: Array<{ trackId: string; title: string; artist?: string; plays: number }>;
  artists: Array<{ name: string; plays: number }>;
}

export interface AdminSession {
  id: string;
  userAgent?: string;
  ipAddress?: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface AdminAuditEntry {
  id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string;
  ipAddress?: string;
  createdAt: string;
}

export interface AdminPlaylistRow {
  id: string;
  name: string;
  trackCount: number;
  userId: string;
  createdAt: string;
}

export type AdminUserAction =
  'promote' | 'demote' | 'suspend' | 'unsuspend' | 'delete' | 'reset-password';

interface AdminOptions {
  otp?: string;
}

function adminHeaders(otp?: string): { 'x-admin-otp'?: string } {
  return otp ? { 'x-admin-otp': otp } : {};
}

export const adminApi = {
  getStats(): Promise<AdminStatsOverview> {
    return apiClient.get<AdminStatsOverview>('/admin/stats/overview');
  },
  getActivity(days = 14): Promise<AdminActivityDay[]> {
    return apiClient.get<AdminActivityDay[]>(`/admin/stats/activity?days=${days}`);
  },
  getTop(limit = 10): Promise<AdminTopStats> {
    return apiClient.get<AdminTopStats>(`/admin/stats/top?limit=${limit}`);
  },
  listUsers(page = 1, limit = 20, query = ''): Promise<{ users: AdminUserRow[]; total: number }> {
    const q = query.trim() ? `&query=${encodeURIComponent(query.trim())}` : '';
    return apiClient.get<{ users: AdminUserRow[]; total: number }>(
      `/admin/users?page=${page}&limit=${limit}${q}`
    );
  },
  getUser(id: string): Promise<{ user: CanonicalUser }> {
    return apiClient.get<{ user: CanonicalUser }>(`/admin/users/${encodeURIComponent(id)}`);
  },
  actOnUser(
    id: string,
    action: AdminUserAction,
    options: AdminOptions = {}
  ): Promise<{ ok?: boolean; token?: string }> {
    return apiClient.patch<{ ok?: boolean; token?: string }>(
      `/admin/users/${encodeURIComponent(id)}`,
      { action },
      adminHeaders(options.otp)
    );
  },
  deleteUser(id: string, options: AdminOptions = {}): Promise<{ ok: boolean }> {
    return apiClient.delete<{ ok: boolean }>(
      `/admin/users/${encodeURIComponent(id)}`,
      adminHeaders(options.otp)
    );
  },
  listSessions(userId: string): Promise<{ sessions: AdminSession[] }> {
    return apiClient.get<{ sessions: AdminSession[] }>(
      `/admin/users/${encodeURIComponent(userId)}/sessions`
    );
  },
  revokeSession(sessionId: string, options: AdminOptions = {}): Promise<{ ok: boolean }> {
    return apiClient.delete<{ ok: boolean }>(
      `/admin/sessions/${encodeURIComponent(sessionId)}`,
      adminHeaders(options.otp)
    );
  },
  listPlaylists(
    page = 1,
    limit = 20,
    query = ''
  ): Promise<{ playlists: AdminPlaylistRow[]; total: number }> {
    const q = query.trim() ? `&query=${encodeURIComponent(query.trim())}` : '';
    return apiClient.get<{ playlists: AdminPlaylistRow[]; total: number }>(
      `/admin/playlists?page=${page}&limit=${limit}${q}`
    );
  },
  deletePlaylist(id: string, options: AdminOptions = {}): Promise<{ ok: boolean }> {
    return apiClient.delete<{ ok: boolean }>(
      `/admin/playlists/${encodeURIComponent(id)}`,
      adminHeaders(options.otp)
    );
  },
  listAudit(page = 1, limit = 30): Promise<{ entries: AdminAuditEntry[]; total: number }> {
    return apiClient.get<{ entries: AdminAuditEntry[]; total: number }>(
      `/admin/audit?page=${page}&limit=${limit}`
    );
  },
  mfaEnroll(): Promise<{ secret: string; otpauthUrl: string }> {
    return apiClient.post<{ secret: string; otpauthUrl: string }>('/admin/mfa/enroll');
  },
  getMfaStatus(): Promise<{ enabled: boolean }> {
    return apiClient.get<{ enabled: boolean }>('/admin/mfa');
  },
  mfaVerify(code: string): Promise<{ ok: boolean }> {
    return apiClient.post<{ ok: boolean }>('/admin/mfa/verify', { code });
  },
  mfaDisable(code: string): Promise<{ ok: boolean }> {
    return apiClient.post<{ ok: boolean }>('/admin/mfa/disable', { code });
  },
};
