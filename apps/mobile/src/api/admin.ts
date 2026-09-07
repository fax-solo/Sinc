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

export interface AdminUserDetail {
  user: CanonicalUser;
  emailVerified: boolean;
  sessionCount: number;
  devices: number;
  favorites: number;
  playlists: number;
  downloads: number;
  completedDownloads: number;
  historyCount: number;
  totalPlays: number;
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

export interface AdminDownloadRow {
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
}

export interface AdminDownloadStats {
  total: number;
  byStatus: Record<string, number>;
  completed: number;
  failed: number;
  successRate: number | null;
}

export interface AdminDeviceRow {
  id: string;
  userId: string;
  name: string;
  platform: string;
  lastSeenAt: string;
  createdAt: string;
}

export interface AdminSystemHealth {
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
}

export interface AdminCacheSizes {
  searchCacheRows: number;
  searchCacheBytes: number | null;
  lyrics: number;
}

export interface AdminReliability {
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
}

export interface FeedDiagnostics {
  generatedAt: number;
  personalized: boolean;
  signal: {
    knownArtists: number;
    playStatsTracks: number;
    thumbsUp: number;
    thumbsDown: number;
    hiddenTracks: number;
    hiddenArtists: number;
    discoveryPreference: number;
    favoriteTracks: number;
    downloadedTracks: number;
  };
  seeds: {
    topArtists: Array<{ name: string; score: number }>;
    topGenres: Array<{ genreId: number; score: number }>;
    onRepeat: Array<{ trackId: string; plays: number; lastPlayedAt: number }>;
  };
  learning: {
    suppressedGenres: Array<{ genreId: number; count: number; artists: string[] }>;
    excludedArtists: string[];
    excludedTrackCount: number;
  };
  sections: Array<{
    index: number;
    kind: string;
    title: string;
    size: number;
    fresh: number;
    known: number;
    thumbsUpBoosted: number;
  }>;
  mixes: Array<{ id: string; size: number; fresh: number; known: number }>;
}

export type AdminUserAction =
  'promote' | 'demote' | 'suspend' | 'unsuspend' | 'delete' | 'reset-password';

export type AdminUserSort = 'createdAt' | 'lastLoginAt';

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
  listUsers(
    page = 1,
    limit = 20,
    opts: {
      query?: string;
      role?: 'user' | 'admin';
      status?: 'active' | 'suspended';
      sort?: AdminUserSort;
    } = {}
  ): Promise<{ users: AdminUserRow[]; total: number }> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (opts.query?.trim()) params.set('query', opts.query.trim());
    if (opts.role) params.set('role', opts.role);
    if (opts.status) params.set('status', opts.status);
    if (opts.sort) params.set('sort', opts.sort);
    return apiClient.get<{ users: AdminUserRow[]; total: number }>(`/admin/users?${params}`);
  },
  getUser(id: string): Promise<{ user: CanonicalUser }> {
    return apiClient.get<{ user: CanonicalUser }>(`/admin/users/${encodeURIComponent(id)}`);
  },
  userDetail(id: string): Promise<AdminUserDetail> {
    return apiClient.get<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}/detail`);
  },
  actOnUser(id: string, action: AdminUserAction): Promise<{ ok?: boolean; token?: string }> {
    return apiClient.patch<{ ok?: boolean; token?: string }>(
      `/admin/users/${encodeURIComponent(id)}`,
      { action }
    );
  },
  deleteUser(id: string): Promise<{ ok: boolean }> {
    return apiClient.delete<{ ok: boolean }>(`/admin/users/${encodeURIComponent(id)}`);
  },
  listSessions(userId: string): Promise<{ sessions: AdminSession[] }> {
    return apiClient.get<{ sessions: AdminSession[] }>(
      `/admin/users/${encodeURIComponent(userId)}/sessions`
    );
  },
  revokeSession(sessionId: string): Promise<{ ok: boolean }> {
    return apiClient.delete<{ ok: boolean }>(`/admin/sessions/${encodeURIComponent(sessionId)}`);
  },
  listPlaylists(
    page = 1,
    limit = 20,
    query = ''
  ): Promise<{ playlists: AdminPlaylistRow[]; total: number }> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (query.trim()) params.set('query', query.trim());
    return apiClient.get<{ playlists: AdminPlaylistRow[]; total: number }>(
      `/admin/playlists?${params}`
    );
  },
  deletePlaylist(id: string): Promise<{ ok: boolean }> {
    return apiClient.delete<{ ok: boolean }>(`/admin/playlists/${encodeURIComponent(id)}`);
  },
  listDownloads(
    page = 1,
    limit = 30,
    opts: { status?: string; query?: string; userId?: string } = {}
  ): Promise<{ jobs: AdminDownloadRow[]; total: number }> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (opts.status) params.set('status', opts.status);
    if (opts.query?.trim()) params.set('query', opts.query.trim());
    if (opts.userId) params.set('userId', opts.userId);
    return apiClient.get<{ jobs: AdminDownloadRow[]; total: number }>(`/admin/downloads?${params}`);
  },
  downloadStats(): Promise<AdminDownloadStats> {
    return apiClient.get<AdminDownloadStats>('/admin/downloads/stats');
  },
  retryDownload(id: string): Promise<{ ok: boolean }> {
    return apiClient.post<{ ok: boolean }>(`/admin/downloads/${encodeURIComponent(id)}/retry`);
  },
  cancelDownload(id: string): Promise<{ ok: boolean }> {
    return apiClient.post<{ ok: boolean }>(`/admin/downloads/${encodeURIComponent(id)}/cancel`);
  },
  listDevices(userId = ''): Promise<{ devices: AdminDeviceRow[]; total: number }> {
    const params = new URLSearchParams();
    if (userId) params.set('userId', userId);
    const qs = params.toString();
    return apiClient.get<{ devices: AdminDeviceRow[]; total: number }>(
      `/admin/devices${qs ? `?${qs}` : ''}`
    );
  },
  revokeDevice(id: string): Promise<{ ok: boolean }> {
    return apiClient.delete<{ ok: boolean }>(`/admin/devices/${encodeURIComponent(id)}`);
  },
  listAudit(
    page = 1,
    limit = 30,
    action = ''
  ): Promise<{ entries: AdminAuditEntry[]; total: number }> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (action) params.set('action', action);
    return apiClient.get<{ entries: AdminAuditEntry[]; total: number }>(`/admin/audit?${params}`);
  },
  getSystem(): Promise<AdminSystemHealth> {
    return apiClient.get<AdminSystemHealth>('/admin/system');
  },
  getCaches(): Promise<AdminCacheSizes> {
    return apiClient.get<AdminCacheSizes>('/admin/caches');
  },
  getReliability(days = 30): Promise<AdminReliability> {
    return apiClient.get<AdminReliability>(`/admin/reliability?days=${days}`);
  },
  getRecommendationsDiagnostics(userId: string): Promise<FeedDiagnostics> {
    return apiClient.get<FeedDiagnostics>(
      `/admin/recommendations/diagnostics?userId=${encodeURIComponent(userId)}`
    );
  },
};
