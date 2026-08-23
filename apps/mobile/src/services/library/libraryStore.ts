import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CanonicalAlbum, CanonicalArtist, CanonicalTrack } from '@sinc/shared';
import { storage, STORAGE_KEYS } from '../../utils/storage';

export interface LocalPlaylist {
  id: string;
  name: string;
  tracks: CanonicalTrack[];
  createdAt: number;
  updatedAt: number;
}

interface LibraryState {
  favoriteTracks: CanonicalTrack[];
  recentlyPlayed: CanonicalTrack[];
  followedArtists: CanonicalArtist[];
  followedAlbums: CanonicalAlbum[];
  playlists: LocalPlaylist[];
  recentlyPlayedPlaylistIds: string[];

  favoriteIds: ReadonlySet<string>;
  followedArtistIds: ReadonlySet<string>;
  followedAlbumIds: ReadonlySet<string>;

  isFavorite: (trackId: string) => boolean;
  toggleFavorite: (track: CanonicalTrack) => void;
  recordPlayed: (track: CanonicalTrack) => void;
  isFollowedArtist: (artistId: string) => boolean;
  toggleFollowArtist: (artist: CanonicalArtist) => void;
  isFollowedAlbum: (albumId: string) => boolean;
  toggleFollowAlbum: (album: CanonicalAlbum) => void;
  addPlaylist: (name: string, tracks?: CanonicalTrack[]) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (id: string, track: CanonicalTrack) => void;
  removeFromPlaylist: (id: string, trackId: string) => void;
  recordPlaylistPlayed: (id: string) => void;
}

const MAX_RECENT = 100;
const MAX_RECENT_PLAYLISTS = 5;

function prependUnique<T extends { id: string }>(items: T[], item: T, max: number): T[] {
  return [item, ...items.filter((i) => i.id !== item.id)].slice(0, max);
}

function idsOf<T extends { id: string }>(items: T[]): Set<string> {
  return new Set(items.map((i) => i.id));
}

function emptyState(): Pick<
  LibraryState,
  | 'favoriteTracks'
  | 'recentlyPlayed'
  | 'followedArtists'
  | 'followedAlbums'
  | 'playlists'
  | 'recentlyPlayedPlaylistIds'
  | 'favoriteIds'
  | 'followedArtistIds'
  | 'followedAlbumIds'
> {
  return {
    favoriteTracks: [],
    recentlyPlayed: [],
    followedArtists: [],
    followedAlbums: [],
    playlists: [],
    recentlyPlayedPlaylistIds: [],
    favoriteIds: new Set<string>(),
    followedArtistIds: new Set<string>(),
    followedAlbumIds: new Set<string>(),
  };
}

function rebuildLookupSets(
  state: Pick<LibraryState, 'favoriteTracks' | 'followedArtists' | 'followedAlbums'>
): Pick<LibraryState, 'favoriteIds' | 'followedArtistIds' | 'followedAlbumIds'> {
  return {
    favoriteIds: idsOf(state.favoriteTracks),
    followedArtistIds: idsOf(state.followedArtists),
    followedAlbumIds: idsOf(state.followedAlbums),
  };
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      ...emptyState(),

      isFavorite: (trackId) => get().favoriteIds.has(trackId),

      toggleFavorite: (track) => {
        const { favoriteTracks } = get();
        const has = favoriteTracks.some((t) => t.id === track.id);
        const next = has
          ? favoriteTracks.filter((t) => t.id !== track.id)
          : [track, ...favoriteTracks];
        set({ favoriteTracks: next, favoriteIds: idsOf(next) });
      },

      recordPlayed: (track) => {
        set({ recentlyPlayed: prependUnique(get().recentlyPlayed, track, MAX_RECENT) });
      },

      isFollowedArtist: (artistId) => get().followedArtistIds.has(artistId),

      toggleFollowArtist: (artist) => {
        const { followedArtists } = get();
        const has = followedArtists.some((a) => a.id === artist.id);
        const next = has
          ? followedArtists.filter((a) => a.id !== artist.id)
          : [artist, ...followedArtists];
        set({ followedArtists: next, followedArtistIds: idsOf(next) });
      },

      isFollowedAlbum: (albumId) => get().followedAlbumIds.has(albumId),

      toggleFollowAlbum: (album) => {
        const { followedAlbums } = get();
        const has = followedAlbums.some((a) => a.id === album.id);
        const next = has
          ? followedAlbums.filter((a) => a.id !== album.id)
          : [album, ...followedAlbums];
        set({ followedAlbums: next, followedAlbumIds: idsOf(next) });
      },

      addPlaylist: (name, tracks = []) => {
        const now = Date.now();
        const id = `playlist-${now}-${Math.random().toString(36).slice(2, 8)}`;
        set({
          playlists: [...get().playlists, { id, name, tracks, createdAt: now, updatedAt: now }],
        });
        return id;
      },

      renamePlaylist: (id, name) => {
        set({
          playlists: get().playlists.map((p) =>
            p.id === id ? { ...p, name, updatedAt: Date.now() } : p
          ),
        });
      },

      deletePlaylist: (id) => {
        set({
          playlists: get().playlists.filter((p) => p.id !== id),
          recentlyPlayedPlaylistIds: get().recentlyPlayedPlaylistIds.filter((pid) => pid !== id),
        });
      },

      addToPlaylist: (id, track) => {
        set({
          playlists: get().playlists.map((p) =>
            p.id === id && !p.tracks.some((t) => t.id === track.id)
              ? { ...p, tracks: [...p.tracks, track], updatedAt: Date.now() }
              : p
          ),
        });
      },

      removeFromPlaylist: (id, trackId) => {
        set({
          playlists: get().playlists.map((p) =>
            p.id === id
              ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId), updatedAt: Date.now() }
              : p
          ),
        });
      },

      recordPlaylistPlayed: (id) => {
        const ids = get().recentlyPlayedPlaylistIds;
        const next = [id, ...ids.filter((i) => i !== id)].slice(0, MAX_RECENT_PLAYLISTS);
        set({ recentlyPlayedPlaylistIds: next });
      },
    }),
    {
      name: STORAGE_KEYS.LIBRARY,
      storage: createJSONStorage(() => ({
        getItem: (key) => storage.getString(key),
        setItem: (key, value) => storage.setString(key, value),
        removeItem: (key) => storage.remove(key),
      })),
      version: 2,
      partialize: (state) => ({
        favoriteTracks: state.favoriteTracks,
        recentlyPlayed: state.recentlyPlayed,
        followedArtists: state.followedArtists,
        followedAlbums: state.followedAlbums,
        playlists: state.playlists,
        recentlyPlayedPlaylistIds: state.recentlyPlayedPlaylistIds,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.favoriteIds = rebuildLookupSets(state).favoriteIds;
          state.followedArtistIds = rebuildLookupSets(state).followedArtistIds;
          state.followedAlbumIds = rebuildLookupSets(state).followedAlbumIds;
        }
      },
      migrate: (persisted) => {
        const state = persisted as Partial<LibraryState>;
        const oldPlaylists = (
          persisted as { playlists?: Array<LocalPlaylist & { trackIds?: string[] }> }
        ).playlists;
        return {
          ...emptyState(),
          ...state,
          playlists: (oldPlaylists ?? []).map((p) =>
            Array.isArray(p.tracks) ? p : { ...p, tracks: [] }
          ),
        };
      },
    }
  )
);
