import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalUser } from '@sinc/shared';
import { apiClient } from '../../api/client';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { useAuthStore } from './authStore';
import type { AuthResponse } from './types';

const user: CanonicalUser = {
  id: 'u1',
  email: 'test@sinc.dev',
  username: 'testuser',
  role: 'user',
  status: 'active',
  createdAt: new Date().toISOString(),
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
  },
};

function authResponse(accessToken: string, refreshToken: string): AuthResponse {
  return { user, tokens: { accessToken, refreshToken, expiresIn: 900 } };
}

function makeResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function stubRoutedFetch(routes: Record<string, (body: unknown) => unknown | [number, unknown]>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const key = `${init?.method ?? 'GET'} ${path}`;
      const handler = routes[key];
      if (!handler) return makeResponse({ message: 'not found' }, 404);
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const result = await handler(body);
      if (Array.isArray(result)) {
        const [status, data] = result;
        return makeResponse(data, status);
      }
      return makeResponse(result);
    })
  );
}

beforeEach(() => {
  storage.remove(STORAGE_KEYS.SESSION);
  apiClient.setAccessToken(null);
  apiClient.setRefreshToken(null);
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, status: 'loading' });
  vi.unstubAllGlobals();
});

describe('authStore', () => {
  it('signs in and applies the session', async () => {
    stubRoutedFetch({
      'POST /auth/login': () => authResponse('at-1', 'rt-1'),
    });

    await useAuthStore.getState().signIn({ email: user.email, password: 'password123' });

    const state = useAuthStore.getState();
    expect(state.status).toBe('signedIn');
    expect(state.user?.email).toBe(user.email);
    expect(state.accessToken).toBe('at-1');
    expect(state.refreshToken).toBe('rt-1');
    expect(apiClient.getAccessToken()).toBe('at-1');
  });

  it('initialize goes signedOut without a stored token', async () => {
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().status).toBe('signedOut');
  });

  it('initialize keeps the session when /auth/me succeeds', async () => {
    useAuthStore.setState({ accessToken: 'at-1', refreshToken: 'rt-1' });
    apiClient.setAccessToken('at-1');
    stubRoutedFetch({ 'GET /auth/me': () => user });

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().status).toBe('signedIn');
    expect(useAuthStore.getState().user?.email).toBe(user.email);
  });

  it('initialize signs out when /auth/me fails', async () => {
    useAuthStore.setState({ accessToken: 'expired-at', refreshToken: 'expired-rt' });
    apiClient.setAccessToken('expired-at');
    apiClient.setRefreshToken('expired-rt');
    stubRoutedFetch({
      'GET /auth/me': () => [401, { message: 'Invalid or expired token' }],
    });

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().status).toBe('signedOut');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('refresh rotates the tokens', async () => {
    useAuthStore.setState({ accessToken: 'at-1', refreshToken: 'rt-1', status: 'signedIn' });
    apiClient.setAccessToken('at-1');
    apiClient.setRefreshToken('rt-1');
    stubRoutedFetch({ 'POST /auth/refresh': () => authResponse('at-2', 'rt-2') });

    const newToken = await useAuthStore.getState().refresh();

    expect(newToken).toBe('at-2');
    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('at-2');
    expect(state.refreshToken).toBe('rt-2');
  });

  it('signOut clears the session', async () => {
    useAuthStore.setState({ user, accessToken: 'at-1', refreshToken: 'rt-1', status: 'signedIn' });
    stubRoutedFetch({ 'POST /auth/logout': () => ({ success: true }) });

    await useAuthStore.getState().signOut();

    const state = useAuthStore.getState();
    expect(state.status).toBe('signedOut');
    expect(state.user).toBeNull();
    expect(apiClient.getAccessToken()).toBeNull();
  });
});
