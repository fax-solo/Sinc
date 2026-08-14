/**
 * Auth/user model shared across client and server.
 */

export type Role = 'USER' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN';

export const ROLE_RANK: Record<Role, number> = {
  USER: 0,
  MODERATOR: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

export function hasRoleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED' | 'PENDING_DELETION';

export interface PublicUser {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  role: Role;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  role: Role;
  status: UserStatus;
  locale: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  compactMode: boolean;
  reducedMotion: boolean;
  playback: {
    autoplay: boolean;
    shuffle: boolean;
    repeat: 'off' | 'one' | 'all';
    crossfadeSeconds: number;
    volumeNormalization: boolean;
    rememberPosition: boolean;
    defaultQuality: 'low' | 'medium' | 'high' | 'lossless';
  };
  downloads: {
    quality: 'low' | 'medium' | 'high' | 'lossless';
    format: 'mp3' | 'm4a' | 'flac' | 'opus';
    wifiOnly: boolean;
    mobileDataAllowed: boolean;
    maxConcurrent: number;
    autoRetry: boolean;
    downloadArtwork: boolean;
    downloadLyrics: boolean;
    downloadSyncedLyrics: boolean;
    embedMetadata: boolean;
  };
  lyrics: {
    showSynced: boolean;
    fontSize: 'small' | 'medium' | 'large';
    timingOffsetMs: number;
    autoScroll: boolean;
    keepScreenOn: boolean;
  };
  notifications: {
    downloads: boolean;
    recommendations: boolean;
    account: boolean;
    updates: boolean;
    security: boolean;
    playbackEvents: boolean;
  };
  privacy: {
    analytics: boolean;
    history: boolean;
    personalizedRecommendations: boolean;
    notificationPersonalization: boolean;
  };
  security: {
    biometricEnabled: boolean;
    biometricForApp: boolean;
    biometricForDownloads: boolean;
    biometricForSettings: boolean;
    sessionTimeoutMinutes: number;
  };
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'system',
  compactMode: false,
  reducedMotion: false,
  playback: {
    autoplay: true,
    shuffle: false,
    repeat: 'off',
    crossfadeSeconds: 0,
    volumeNormalization: true,
    rememberPosition: true,
    defaultQuality: 'high',
  },
  downloads: {
    quality: 'high',
    format: 'm4a',
    wifiOnly: true,
    mobileDataAllowed: false,
    maxConcurrent: 3,
    autoRetry: true,
    downloadArtwork: true,
    downloadLyrics: true,
    downloadSyncedLyrics: true,
    embedMetadata: true,
  },
  lyrics: {
    showSynced: true,
    fontSize: 'medium',
    timingOffsetMs: 0,
    autoScroll: true,
    keepScreenOn: false,
  },
  notifications: {
    downloads: true,
    recommendations: false,
    account: true,
    updates: true,
    security: true,
    playbackEvents: false,
  },
  privacy: {
    analytics: false,
    history: true,
    personalizedRecommendations: true,
    notificationPersonalization: false,
  },
  security: {
    biometricEnabled: false,
    biometricForApp: false,
    biometricForDownloads: false,
    biometricForSettings: false,
    sessionTimeoutMinutes: 60,
  },
};

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SessionInfo {
  id: string;
  deviceId: string;
  platform?: string;
  lastUsedAt: string;
  isCurrent: boolean;
}

export interface NotificationPreferences {
  downloads: boolean;
  recommendations: boolean;
  account: boolean;
  updates: boolean;
  security: boolean;
  playbackEvents: boolean;
}
