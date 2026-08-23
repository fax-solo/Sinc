import type { CanonicalUser, UserSettings } from '@sinc/shared';
import type { User } from '@prisma/client';

const defaultSettings: UserSettings = {
  theme: 'dark',
  playbackQuality: 'high',
  downloadQuality: 'high',
  downloadOverWifiOnly: true,
  autoDownloadFavorites: false,
  autoplay: true,
  shuffleDefault: false,
  repeatDefault: 'off',
  notifications: { downloads: true, recommendations: true, account: true },
  biometricLock: false,
};

export function toCanonicalUser(user: User): CanonicalUser {
  const stored = (user.settings ?? {}) as Partial<UserSettings>;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
    role: (user.role as CanonicalUser['role']) ?? 'user',
    status: (user.status as CanonicalUser['status']) ?? 'active',
    createdAt: user.createdAt.toISOString(),
    settings: { ...defaultSettings, ...stored },
  };
}
