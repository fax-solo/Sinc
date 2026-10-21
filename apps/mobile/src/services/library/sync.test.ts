import { beforeEach, describe, expect, it } from 'vitest';
import { useLibraryStore } from '../library/libraryStore';
import { recordCollectionPlay, recordPlay, syncFavorites } from './sync';

const track = (id: string) => ({
  id,
  title: `Song ${id}`,
  artists: [{ id: `artist:${id}`, name: 'Artist', providerIds: {}, genres: [] }],
  durationMs: 1000,
  artworkUrl: undefined,
  providerIds: {},
  explicit: false,
});

beforeEach(() => {
  useLibraryStore.setState({
    recentlyPlayed: [],
    recentlyPlayedPlaylistIds: [],
  });
});

describe('local sync', () => {
  it('recordPlay adds the track to recently played', () => {
    recordPlay(track('t1'));
    expect(useLibraryStore.getState().recentlyPlayed.map((t) => t.id)).toEqual(['t1']);
  });

  it('recordPlay moves a repeated play to the front without duplicating', () => {
    recordPlay(track('a'));
    recordPlay(track('b'));
    recordPlay(track('a'));
    expect(useLibraryStore.getState().recentlyPlayed.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('recordCollectionPlay records playlist plays', () => {
    recordCollectionPlay({ id: 'pl-1', type: 'playlist', title: 'Workout' });
    expect(useLibraryStore.getState().recentlyPlayedPlaylistIds).toEqual(['pl-1']);
  });

  it('recordCollectionPlay ignores non-playlist collections', () => {
    recordCollectionPlay({ id: 'mix-1', type: 'mix', title: 'Mood' });
    recordCollectionPlay({ id: 'alb-1', type: 'album', title: 'Album' });
    expect(useLibraryStore.getState().recentlyPlayedPlaylistIds).toEqual([]);
  });

  it('syncFavorites resolves without changing anything locally', async () => {
    useLibraryStore.setState({ favoriteTracks: [track('t1')] });
    await syncFavorites();
    expect(useLibraryStore.getState().favoriteTracks.map((t) => t.id)).toEqual(['t1']);
  });
});
