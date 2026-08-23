import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CanonicalUser } from '@sinc/shared';
import { apiClient } from '../../api/client';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { authApi } from './api';
import type { LoginInput, RegisterInput } from './types';

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

interface AuthState {
  user: CanonicalUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  status: AuthStatus;
  initialize: () => Promise<void>;
  signIn: (input: LoginInput) => Promise<void>;
  signUp: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<string | null>;
}

function applySession(
  set: (partial: Partial<AuthState>) => void,
  user: CanonicalUser,
  tokens: { accessToken: string; refreshToken: string }
): void {
  apiClient.setAccessToken(tokens.accessToken);
  apiClient.setRefreshToken(tokens.refreshToken);
  set({
    user,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    status: 'signedIn',
  });
}

function clearSession(set: (partial: Partial<AuthState>) => void): void {
  apiClient.setAccessToken(null);
  apiClient.setRefreshToken(null);
  set({ user: null, accessToken: null, refreshToken: null, status: 'signedOut' });
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      status: 'loading',

      initialize: async () => {
        const { accessToken } = get();
        if (!accessToken) {
          set({ status: 'signedOut' });
          return;
        }
        apiClient.setAccessToken(accessToken);
        try {
          const user = await authApi.me();
          set({ user, status: 'signedIn' });
        } catch {
          clearSession(set);
        }
      },

      signIn: async (input) => {
        const result = await authApi.login(input);
        applySession(set, result.user, result.tokens);
      },

      signUp: async (input) => {
        const result = await authApi.register(input);
        applySession(set, result.user, result.tokens);
      },

      signOut: async () => {
        const { refreshToken } = get();
        if (refreshToken) {
          await authApi.logout(refreshToken).catch(() => undefined);
        }
        clearSession(set);
      },

      refresh: async () => {
        const { refreshToken } = get();
        if (!refreshToken) return null;
        try {
          const result = await authApi.refresh(refreshToken);
          applySession(set, result.user, result.tokens);
          return result.tokens.accessToken;
        } catch {
          clearSession(set);
          return null;
        }
      },
    }),
    {
      name: STORAGE_KEYS.SESSION,
      storage: createJSONStorage(() => ({
        getItem: (key) => storage.getString(key),
        setItem: (key, value) => storage.setString(key, value),
        removeItem: (key) => storage.remove(key),
      })),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    }
  )
);

// Hydration is synchronous (MMKV is a sync adapter), so the persisted session
// is already available on getState() right after create(). Wire the client
// to the store: tokens for auth headers, and a single-flight refresh handler.
const { accessToken, refreshToken } = useAuthStore.getState();
apiClient.setAccessToken(accessToken);
apiClient.setRefreshToken(refreshToken);
apiClient.setRefreshHandler(() => useAuthStore.getState().refresh());
