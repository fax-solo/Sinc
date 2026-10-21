import { create } from 'zustand';
import type { CanonicalUser } from '@sinc/shared';

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

/**
 * Local-only identity. There is no backend (or VPS) in the local build: the
 * app boots into a single, always-present local profile. No tokens, no keychain
 * session, no login screen — the PIN app-lock remains the only gate.
 */
export const LOCAL_USER: CanonicalUser = {
  id: 'local',
  email: 'local@sinc.local',
  username: 'you',
  role: 'user',
  status: 'active',
  createdAt: new Date(0).toISOString(),
  settings: {
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
    analyticsEnabled: false,
  },
};

interface AuthState {
  user: CanonicalUser;
  accessToken: string | null;
  refreshToken: string | null;
  status: AuthStatus;
  initialize: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<string | null>;
}

export const useAuthStore = create<AuthState>(() => ({
  user: LOCAL_USER,
  accessToken: null,
  refreshToken: null,
  status: 'signedIn',

  initialize: async () => {
    // Nothing to restore: the local profile is always present.
  },

  signOut: async () => {
    // Nothing to sign out of. The local library belongs to the device.
  },

  refresh: async () => null,
}));
