import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { useAuthStore } from '../../features/auth/authStore';
import { useLibraryStore } from '../library/libraryStore';
import { recordPlay, syncFavorites } from './sync';

const track = (id: string): CanonicalTrack => ({
  id,
  title: `Song ${id}`,
  artists: [{ id: `artist:${id}`, name: 'Artist', providerIds: {}, genres: [] }],
  durationMs: 1000,
  artworkUrl: undefined,
  providerIds: {},
  explicit: false,
});

vi.mock('../../api/music', () => ({
  musicApi: {
    recordPlay: vi.fn().mockResolvedValue({ ok: true }),
    syncFavorites: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

import { musicApi } from '../../api/music';

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    status: 'signedOut',
  });
  useLibraryStore.setState({ favoriteTracks: [] });
});

describe('library sync', () => {
  it('recordPlay is a no-op when signed out', () => {
    recordPlay(track('t1'));
    expect(musicApi.recordPlay).not.toHaveBeenCalled();
  });

  it('recordPlay uploads the play when signed in', () => {
    useAuthStore.setState({ status: 'signedIn', accessToken: 'at', refreshToken: 'rt' });
    recordPlay(track('t1'));
    expect(musicApi.recordPlay).toHaveBeenCalledWith(track('t1'));
  });

  it('syncFavorites is a no-op when signed out', () => {
    useLibraryStore.setState({ favoriteTracks: [track('t1')] });
    syncFavorites();
    expect(musicApi.syncFavorites).not.toHaveBeenCalled();
  });

  it('syncFavorites uploads the local favorites when signed in', async () => {
    useAuthStore.setState({ status: 'signedIn', accessToken: 'at', refreshToken: 'rt' });
    useLibraryStore.setState({ favoriteTracks: [track('t1'), track('t2')] });
    syncFavorites();
    await vi.waitFor(() => {
      expect(musicApi.syncFavorites).toHaveBeenCalledWith([track('t1'), track('t2')]);
    });
  });

  it('serializes rapid syncs into the latest list', async () => {
    useAuthStore.setState({ status: 'signedIn', accessToken: 'at', refreshToken: 'rt' });
    let resolveFirst: (v: { ok: boolean }) => void;
    const gate = new Promise<{ ok: boolean }>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(musicApi.syncFavorites).mockReturnValueOnce(gate as never);

    useLibraryStore.setState({ favoriteTracks: [track('t1')] });
    syncFavorites();
    useLibraryStore.setState({ favoriteTracks: [track('t1'), track('t2')] });
    syncFavorites();

    expect(musicApi.syncFavorites).toHaveBeenCalledTimes(1);
    resolveFirst!({ ok: true });
    await vi.waitFor(() => {
      expect(musicApi.syncFavorites).toHaveBeenCalledWith([track('t1'), track('t2')]);
    });
  });

  it('never rejects when the server call fails', async () => {
    useAuthStore.setState({ status: 'signedIn', accessToken: 'at', refreshToken: 'rt' });
    vi.mocked(musicApi.syncFavorites).mockRejectedValueOnce(new Error('boom'));
    useLibraryStore.setState({ favoriteTracks: [track('t1')] });
    await expect(syncFavorites()).resolves.toBeUndefined();
  });
});
