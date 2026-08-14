import { create } from 'zustand';
import type { PublicUser } from '@sinc/shared';
import { storage, STORAGE_KEYS } from '../storage';
import { secureStorage, SECURE_KEYS } from '../security/secureStorage';
import { authApi } from '../api/auth';

/**
 * Auth state. Access/refresh tokens live in SecureStorage (Keychain /
 * Keystore); the user profile + bookkeeping live in KVStorage. On every
 * app start `hydrate` restores both and tries a silent refresh if the
 * access token is missing/expired.
 */

export type AuthStatus = 'idle' | 'hydrating' | 'unauthenticated' | 'authenticated';

interface AuthState {
  status: AuthStatus;
  user: PublicUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    username: string;
    displayName?: string;
    locale?: string;
  }) => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  refreshSession: () => Promise<boolean>;
  logout: () => Promise<void>;
  clearSession: () => void;
  setUser: (user: PublicUser) => void;
}

function persistUser(user: PublicUser | null): void {
  if (user) {
    storage.setString(STORAGE_KEYS.AUTH, JSON.stringify({ user }));
  } else {
    storage.remove(STORAGE_KEYS.AUTH);
  }
}

async function persistTokens(access: string | null, refresh: string | null): Promise<void> {
  if (access) await secureStorage.setItem(SECURE_KEYS.ACCESS_TOKEN, access);
  else await secureStorage.removeItem(SECURE_KEYS.ACCESS_TOKEN);
  if (refresh) await secureStorage.setItem(SECURE_KEYS.REFRESH_TOKEN, refresh);
  else await secureStorage.removeItem(SECURE_KEYS.REFRESH_TOKEN);
}

async function readUser(): Promise<PublicUser | null> {
  const raw = storage.getString(STORAGE_KEYS.AUTH);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { user?: PublicUser };
    return parsed.user ?? null;
  } catch {
    storage.remove(STORAGE_KEYS.AUTH);
    return null;
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  user: null,
  accessToken: null,
  refreshToken: null,
  isHydrated: false,

  hydrate: async () => {
    if (get().isHydrated) return;
    set({ status: 'hydrating' });
    const user = await readUser();
    const accessToken = await secureStorage.getItem(SECURE_KEYS.ACCESS_TOKEN);
    const refreshToken = await secureStorage.getItem(SECURE_KEYS.REFRESH_TOKEN);
    if (user && refreshToken) {
      set({ user, accessToken, refreshToken, isHydrated: true, status: 'authenticated' });
      // Opportunistic silent refresh to validate/rotate the session.
      void get().refreshSession();
    } else {
      set({
        user: null,
        accessToken: null,
        refreshToken: null,
        isHydrated: true,
        status: 'unauthenticated',
      });
    }
  },

  login: async (email, password) => {
    const result = await authApi.login(email, password);
    await persistTokens(result.accessToken, result.refreshToken);
    persistUser(result.user);
    set({
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      status: 'authenticated',
    });
  },

  register: async (input) => {
    const result = await authApi.register(input);
    await persistTokens(result.accessToken, result.refreshToken);
    persistUser(result.user);
    set({
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      status: 'authenticated',
    });
  },

  verifyEmail: async (token) => {
    const result = await authApi.verifyEmail(token);
    await persistTokens(result.accessToken, result.refreshToken);
    persistUser(result.user);
    set({
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      status: 'authenticated',
    });
  },

  refreshSession: async () => {
    const refreshToken = get().refreshToken;
    if (!refreshToken) return false;
    try {
      const result = await authApi.refresh(refreshToken);
      await persistTokens(result.accessToken, result.refreshToken);
      persistUser(result.user);
      set({
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        status: 'authenticated',
      });
      return true;
    } catch {
      // Refresh failed: clear the session rather than staying in a broken
      // authenticated state.
      get().clearSession();
      return false;
    }
  },

  logout: async () => {
    const refreshToken = get().refreshToken;
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch {
        // Server-side revoke is best-effort; always clear locally.
      }
    }
    get().clearSession();
  },

  clearSession: () => {
    void persistTokens(null, null);
    persistUser(null);
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      status: 'unauthenticated',
      isHydrated: true,
    });
  },

  setUser: (user) => {
    persistUser(user);
    set({ user });
  },
}));
