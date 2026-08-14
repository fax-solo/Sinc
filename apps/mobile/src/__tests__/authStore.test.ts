import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PublicUser } from '@sinc/shared';

const USER: PublicUser = {
  id: 'user_1',
  username: 'fan',
  role: 'USER',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const AUTH_RESULT = {
  user: USER,
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresIn: 900,
};

function makeApiStub() {
  const refresh = vi.fn();
  const logout = vi.fn();
  const login = vi.fn();
  const register = vi.fn();
  const verifyEmail = vi.fn();
  vi.doMock('../api/auth', () => ({
    authApi: {
      login,
      register,
      refresh,
      logout,
      verifyEmail,
      requestPasswordReset: vi.fn(),
      confirmPasswordReset: vi.fn(),
      resendVerification: vi.fn(),
    },
  }));
  return { refresh, logout, login, register, verifyEmail };
}

/** Load a fresh module graph (fresh mocks + fresh in-memory storage). */
async function loadStore() {
  const { useAuthStore } = await import('../state/authStore');
  const { secureStorage, SECURE_KEYS } = await import('../security/secureStorage');
  return { store: useAuthStore, secureStorage, SECURE_KEYS };
}

describe('authStore', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('hydrates with no session as unauthenticated', async () => {
    makeApiStub();
    const { store } = await loadStore();
    await store.getState().hydrate();
    expect(store.getState().status).toBe('unauthenticated');
    expect(store.getState().isHydrated).toBe(true);
  });

  it('login persists tokens to secure storage and marks authenticated', async () => {
    const api = makeApiStub();
    api.login.mockResolvedValue(AUTH_RESULT);
    const { store, secureStorage, SECURE_KEYS } = await loadStore();

    await store.getState().login('a@b.c', 'password123');
    expect(store.getState().status).toBe('authenticated');
    expect(store.getState().user?.username).toBe('fan');
    expect(await secureStorage.getItem(SECURE_KEYS.ACCESS_TOKEN)).toBe('access-1');
    expect(await secureStorage.getItem(SECURE_KEYS.REFRESH_TOKEN)).toBe('refresh-1');
  });

  it('logout calls the API then clears state', async () => {
    const api = makeApiStub();
    api.login.mockResolvedValue(AUTH_RESULT);
    api.logout.mockResolvedValue(undefined);
    const { store, secureStorage, SECURE_KEYS } = await loadStore();
    await store.getState().login('a@b.c', 'password123');

    await store.getState().logout();
    expect(api.logout).toHaveBeenCalledWith('refresh-1');
    expect(store.getState().status).toBe('unauthenticated');
    expect(store.getState().user).toBeNull();
    expect(await secureStorage.getItem(SECURE_KEYS.ACCESS_TOKEN)).toBeNull();
  });

  it('refreshSession rotates tokens and returns true', async () => {
    const api = makeApiStub();
    api.login.mockResolvedValue(AUTH_RESULT);
    api.refresh.mockResolvedValue({
      ...AUTH_RESULT,
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });
    const { store, secureStorage, SECURE_KEYS } = await loadStore();
    await store.getState().login('a@b.c', 'password123');

    const ok = await store.getState().refreshSession();
    expect(ok).toBe(true);
    expect(store.getState().accessToken).toBe('access-2');
    expect(await secureStorage.getItem(SECURE_KEYS.REFRESH_TOKEN)).toBe('refresh-2');
  });

  it('refreshSession failure clears the session', async () => {
    const api = makeApiStub();
    api.login.mockResolvedValue(AUTH_RESULT);
    api.refresh.mockRejectedValue(new Error('expired'));
    const { store } = await loadStore();
    await store.getState().login('a@b.c', 'password123');

    const ok = await store.getState().refreshSession();
    expect(ok).toBe(false);
    expect(store.getState().status).toBe('unauthenticated');
    expect(store.getState().user).toBeNull();
  });

  it('verifyEmail authenticates the user', async () => {
    const api = makeApiStub();
    api.verifyEmail.mockResolvedValue(AUTH_RESULT);
    const { store } = await loadStore();
    await store.getState().verifyEmail('token-123');
    expect(store.getState().status).toBe('authenticated');
    expect(store.getState().user?.id).toBe('user_1');
  });

  it('register authenticates the user', async () => {
    const api = makeApiStub();
    api.register.mockResolvedValue(AUTH_RESULT);
    const { store } = await loadStore();
    await store.getState().register({
      email: 'a@b.c',
      password: 'password123',
      username: 'fan',
    });
    expect(store.getState().status).toBe('authenticated');
    expect(api.register).toHaveBeenCalledTimes(1);
  });
});
