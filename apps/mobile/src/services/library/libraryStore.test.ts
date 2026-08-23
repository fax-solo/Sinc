import { beforeEach, describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { useLibraryStore } from './libraryStore';

function track(id: string, title = `Track ${id}`): CanonicalTrack {
  return {
    id,
    title,
    artists: [{ id: `a-${id}`, name: 'Artist', providerIds: {}, genres: [] }],
    durationMs: 1000,
    artworkUrl: undefined,
    providerIds: { itunes: id },
    explicit: false,
  };
}

function resetStore() {
  void useLibraryStore.persist.clearStorage();
  useLibraryStore.setState({
    favoriteTracks: [],
    recentlyPlayed: [],
    followedArtists: [],
    followedAlbums: [],
    playlists: [],
  });
}

beforeEach(() => {
  storage.remove(STORAGE_KEYS.LIBRARY);
  resetStore();
});

describe('libraryStore', () => {
  it('toggles favorite tracks', () => {
    const t = track('itunes:1');
    expect(useLibraryStore.getState().isFavorite(t.id)).toBe(false);

    useLibraryStore.getState().toggleFavorite(t);
    expect(useLibraryStore.getState().isFavorite(t.id)).toBe(true);
    expect(useLibraryStore.getState().favoriteTracks).toHaveLength(1);

    useLibraryStore.getState().toggleFavorite(t);
    expect(useLibraryStore.getState().isFavorite(t.id)).toBe(false);
    expect(useLibraryStore.getState().favoriteTracks).toHaveLength(0);
  });

  it('recordPlayed prepends and de-duplicates recents', () => {
    const t1 = track('itunes:1');
    const t2 = track('itunes:2');

    useLibraryStore.getState().recordPlayed(t1);
    useLibraryStore.getState().recordPlayed(t2);
    useLibraryStore.getState().recordPlayed(t1);

    expect(useLibraryStore.getState().recentlyPlayed.map((t) => t.id)).toEqual([
      'itunes:1',
      'itunes:2',
    ]);
  });

  it('recordPlayed caps the recent list', () => {
    const max = 100;
    for (let i = 0; i < max + 10; i++) {
      useLibraryStore.getState().recordPlayed(track(`itunes:${i}`));
    }
    expect(useLibraryStore.getState().recentlyPlayed).toHaveLength(max);
  });

  it('toggles followed artists and albums', () => {
    const artist = {
      id: 'artist-1',
      name: 'A',
      providerIds: {},
      genres: [],
      artworkUrl: undefined,
    };
    const album = {
      id: 'album-1',
      title: 'Al',
      artist: { id: 'artist-1', name: 'A', providerIds: {}, genres: [], artworkUrl: undefined },
      providerIds: {},
      artworkUrl: undefined,
      trackCount: 0,
      type: 'album' as const,
    };

    useLibraryStore.getState().toggleFollowArtist(artist);
    expect(useLibraryStore.getState().isFollowedArtist('artist-1')).toBe(true);

    useLibraryStore.getState().toggleFollowAlbum(album);
    expect(useLibraryStore.getState().isFollowedAlbum('album-1')).toBe(true);

    useLibraryStore.getState().toggleFollowArtist(artist);
    expect(useLibraryStore.getState().isFollowedArtist('artist-1')).toBe(false);
  });

  it('creates, renames, deletes playlists', () => {
    const id = useLibraryStore.getState().addPlaylist('Road trip');
    expect(useLibraryStore.getState().playlists).toHaveLength(1);

    useLibraryStore.getState().renamePlaylist(id, 'Gym');
    expect(useLibraryStore.getState().playlists[0]?.name).toBe('Gym');

    useLibraryStore.getState().deletePlaylist(id);
    expect(useLibraryStore.getState().playlists).toHaveLength(0);
  });

  it('adds and removes tracks from a playlist without duplicates', () => {
    const id = useLibraryStore.getState().addPlaylist('Mix');
    useLibraryStore.getState().addToPlaylist(id, track('itunes:1'));
    useLibraryStore.getState().addToPlaylist(id, track('itunes:1'));
    useLibraryStore.getState().addToPlaylist(id, track('itunes:2'));
    expect(useLibraryStore.getState().playlists[0]?.tracks.map((t) => t.id)).toEqual([
      'itunes:1',
      'itunes:2',
    ]);

    useLibraryStore.getState().removeFromPlaylist(id, 'itunes:1');
    expect(useLibraryStore.getState().playlists[0]?.tracks.map((t) => t.id)).toEqual(['itunes:2']);
  });

  it('tracks recently played playlists, most recent first', () => {
    const a = useLibraryStore.getState().addPlaylist('A');
    const b = useLibraryStore.getState().addPlaylist('B');
    const c = useLibraryStore.getState().addPlaylist('C');

    useLibraryStore.getState().recordPlaylistPlayed(a);
    useLibraryStore.getState().recordPlaylistPlayed(b);
    useLibraryStore.getState().recordPlaylistPlayed(c);
    useLibraryStore.getState().recordPlaylistPlayed(a);

    expect(useLibraryStore.getState().recentlyPlayedPlaylistIds).toEqual([a, c, b]);
  });

  it('removes deleted playlists from recently played', () => {
    const id = useLibraryStore.getState().addPlaylist('Soon gone');
    useLibraryStore.getState().recordPlaylistPlayed(id);
    useLibraryStore.getState().deletePlaylist(id);
    expect(useLibraryStore.getState().recentlyPlayedPlaylistIds).not.toContain(id);
  });
});
