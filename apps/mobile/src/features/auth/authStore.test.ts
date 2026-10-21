import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from './authStore';

beforeEach(() => {
  useAuthStore.setState({
    user: useAuthStore.getState().user,
    accessToken: null,
    refreshToken: null,
    status: 'signedIn',
  });
});

describe('authStore (local identity)', () => {
  it('boots straight into a signed-in local profile', () => {
    const state = useAuthStore.getState();
    expect(state.status).toBe('signedIn');
    expect(state.user?.id).toBe('local');
    expect(state.user?.username).toBe('you');
    expect(state.user?.role).toBe('user');
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
  });

  it('initialize is a no-op and leaves the local profile intact', async () => {
    await useAuthStore.getState().initialize();
    const state = useAuthStore.getState();
    expect(state.status).toBe('signedIn');
    expect(state.user?.id).toBe('local');
  });

  it('signOut keeps the local profile (no server session to clear)', async () => {
    await useAuthStore.getState().signOut();
    const state = useAuthStore.getState();
    expect(state.status).toBe('signedIn');
    expect(state.user?.id).toBe('local');
  });

  it('refresh always resolves null (no tokens to rotate)', async () => {
    expect(await useAuthStore.getState().refresh()).toBeNull();
  });
});
