import type { CanonicalAlbum, CanonicalArtist, CanonicalTrack } from '@sinc/shared';
import type { LocalPlaylist } from '../../services/library/libraryStore';

export interface LocalSearchResults {
  tracks: CanonicalTrack[];
  artists: CanonicalArtist[];
  albums: CanonicalAlbum[];
  playlists: LocalPlaylist[];
  downloadedIds: Set<string>;
}

const normalise = (value: string): string => value.trim().toLowerCase();

function matches(haystack: Array<string | undefined>, query: string): boolean {
  return haystack.some((value) => value?.toLowerCase().includes(query));
}

export function searchLocalLibrary(input: {
  query: string;
  recentlyPlayed: CanonicalTrack[];
  favorites: CanonicalTrack[];
  downloadedTracks: CanonicalTrack[];
  playlists: LocalPlaylist[];
  artists: CanonicalArtist[];
  albums: CanonicalAlbum[];
}): LocalSearchResults {
  const query = normalise(input.query);
  const empty: LocalSearchResults = {
    tracks: [],
    artists: [],
    albums: [],
    playlists: [],
    downloadedIds: new Set<string>(),
  };
  if (query.length < 2) return empty;

  const knownTracks = new Map<string, CanonicalTrack>();
  const downloadedIds = new Set(input.downloadedTracks.map((track) => track.id));
  for (const track of [
    ...input.downloadedTracks,
    ...input.favorites,
    ...input.recentlyPlayed,
  ]) {
    if (!knownTracks.has(track.id)) knownTracks.set(track.id, track);
  }

  return {
    tracks: [...knownTracks.values()]
      .filter((track) =>
        matches(
          [
            track.title,
            track.album?.title,
            ...track.artists.map((artist) => artist.name),
          ],
          query
        )
      )
      .slice(0, 30),
    artists: input.artists
      .filter((artist) => matches([artist.name, ...artist.genres], query))
      .slice(0, 12),
    albums: input.albums
      .filter((album) => matches([album.title, album.artist?.name], query))
      .slice(0, 12),
    playlists: input.playlists
      .filter((playlist) =>
        matches([playlist.name, playlist.description], query) ||
        playlist.tracks.some((track) =>
          matches([track.title, ...track.artists.map((artist) => artist.name)], query)
        )
      )
      .slice(0, 12),
    downloadedIds,
  };
}
