import { Database, Q, type Query } from '@nozbe/watermelondb';
import { createId, normalizeName, type FavoriteTarget } from './schema';
import { Album, Artist, Favorite, HistoryEntry, Playlist, PlaylistEntry, Track } from './models';
import {
  enqueueFavoriteToggleOp,
  enqueuePlaylistDeleteOp,
  enqueuePlaylistUpsertOp,
} from './syncOps';

export type TrackSort = 'title' | 'artist' | 'recent';
export type AlbumSort = 'title' | 'artist' | 'recent';
export type ArtistSort = 'name' | 'recent';
export type PlaylistSort = 'name' | 'recent';

const tracks = (db: Database) => db.collections.get<Track>('tracks');
const artists = (db: Database) => db.collections.get<Artist>('artists');
const albums = (db: Database) => db.collections.get<Album>('albums');
const playlists = (db: Database) => db.collections.get<Playlist>('playlists');
const entries = (db: Database) => db.collections.get<PlaylistEntry>('playlist_entries');
const favorites = (db: Database) => db.collections.get<Favorite>('favorites');
const history = (db: Database) => db.collections.get<HistoryEntry>('history');

/* ------------------------------------------------------------------ tracks */

export interface NewTrackInput {
  title: string;
  artistId?: string | null;
  albumId?: string | null;
  durationMs?: number | null;
  trackNumber?: number | null;
  providerId?: string | null;
  sourceKind: 'LOCAL' | 'REMOTE' | 'CACHED';
  uri?: string | null;
  artworkUrl?: string | null;
  addedAt?: number;
}

export async function saveTrack(db: Database, input: NewTrackInput): Promise<Track> {
  return db.write(async () => {
    const existing = input.providerId
      ? ((await tracks(db).query(Q.where('provider_id', input.providerId)).fetch())[0] ?? null)
      : null;
    if (existing) {
      return existing.update((track) => {
        track.title = input.title;
        track.normalizedTitle = normalizeName(input.title);
        track.artistId = input.artistId ?? null;
        track.albumId = input.albumId ?? null;
        track.durationMs = input.durationMs ?? null;
        track.trackNumber = input.trackNumber ?? null;
        track.sourceKind = input.sourceKind;
        track.uri = input.uri ?? null;
        track.artworkUrl = input.artworkUrl ?? null;
      });
    }
    return tracks(db).create((track) => {
      track.title = input.title;
      track.normalizedTitle = normalizeName(input.title);
      track.artistId = input.artistId ?? null;
      track.albumId = input.albumId ?? null;
      track.durationMs = input.durationMs ?? null;
      track.trackNumber = input.trackNumber ?? null;
      track.providerId = input.providerId ?? null;
      track.sourceKind = input.sourceKind;
      track.uri = input.uri ?? null;
      track.artworkUrl = input.artworkUrl ?? null;
      track.addedAt = input.addedAt ?? Date.now();
    });
  });
}

export async function removeTrack(db: Database, id: string): Promise<void> {
  await db.write(async () => {
    const track = await tracks(db).find(id);
    await track.destroyPermanently();
  });
}

export function tracksQuery(
  db: Database,
  sort: TrackSort = 'title',
  search?: string,
): Query<Track> {
  let q = tracks(db).query();
  if (search && search.trim().length > 0) {
    q = q.extend(Q.where('normalized_title', Q.like(`%${normalizeName(search)}%`)));
  }
  if (sort === 'artist') {
    q = q.extend(Q.sortBy('artist_id', Q.asc), Q.sortBy('title', Q.asc));
  } else if (sort === 'recent') {
    q = q.extend(Q.sortBy('added_at', Q.desc));
  } else {
    q = q.extend(Q.sortBy('title', Q.asc));
  }
  return q;
}

export async function trackCount(db: Database): Promise<number> {
  return tracks(db).query().fetchCount();
}

/* ------------------------------------------------------------------ artists */

export interface NewArtistInput {
  name: string;
  providerId?: string | null;
  artworkUrl?: string | null;
}

export async function saveArtist(db: Database, input: NewArtistInput): Promise<Artist> {
  return db.write(async () => {
    const existing = input.providerId
      ? ((await artists(db).query(Q.where('provider_id', input.providerId)).fetch())[0] ?? null)
      : null;
    if (existing) {
      return existing.update((artist) => {
        artist.name = input.name;
        artist.normalizedName = normalizeName(input.name);
        artist.artworkUrl = input.artworkUrl ?? null;
      });
    }
    return artists(db).create((artist) => {
      artist.name = input.name;
      artist.normalizedName = normalizeName(input.name);
      artist.providerId = input.providerId ?? null;
      artist.artworkUrl = input.artworkUrl ?? null;
      artist.addedAt = Date.now();
    });
  });
}

export function artistsQuery(
  db: Database,
  sort: ArtistSort = 'name',
  search?: string,
): Query<Artist> {
  let q = artists(db).query();
  if (search && search.trim().length > 0) {
    q = q.extend(Q.where('normalized_name', Q.like(`%${normalizeName(search)}%`)));
  }
  return sort === 'recent'
    ? q.extend(Q.sortBy('added_at', Q.desc))
    : q.extend(Q.sortBy('name', Q.asc));
}

/* ------------------------------------------------------------------- albums */

export interface NewAlbumInput {
  title: string;
  artistId?: string | null;
  year?: number | null;
  providerId?: string | null;
  artworkUrl?: string | null;
}

export async function saveAlbum(db: Database, input: NewAlbumInput): Promise<Album> {
  return db.write(async () => {
    const existing = input.providerId
      ? ((await albums(db).query(Q.where('provider_id', input.providerId)).fetch())[0] ?? null)
      : null;
    if (existing) {
      return existing.update((album) => {
        album.title = input.title;
        album.normalizedTitle = normalizeName(input.title);
        album.artistId = input.artistId ?? null;
        album.year = input.year ?? null;
        album.artworkUrl = input.artworkUrl ?? null;
      });
    }
    return albums(db).create((album) => {
      album.title = input.title;
      album.normalizedTitle = normalizeName(input.title);
      album.artistId = input.artistId ?? null;
      album.year = input.year ?? null;
      album.providerId = input.providerId ?? null;
      album.artworkUrl = input.artworkUrl ?? null;
      album.addedAt = Date.now();
    });
  });
}

export function albumsQuery(
  db: Database,
  sort: AlbumSort = 'title',
  search?: string,
): Query<Album> {
  let q = albums(db).query();
  if (search && search.trim().length > 0) {
    q = q.extend(Q.where('normalized_title', Q.like(`%${normalizeName(search)}%`)));
  }
  if (sort === 'artist') {
    q = q.extend(Q.sortBy('artist_id', Q.asc), Q.sortBy('title', Q.asc));
  } else if (sort === 'recent') {
    q = q.extend(Q.sortBy('added_at', Q.desc));
  } else {
    q = q.extend(Q.sortBy('title', Q.asc));
  }
  return q;
}

/* ---------------------------------------------------------------- playlists */

export interface NewPlaylistInput {
  name: string;
  description?: string | null;
  isCollaborative?: boolean;
}

export async function createPlaylist(db: Database, input: NewPlaylistInput): Promise<Playlist> {
  return db.write(async () => {
    const playlist = await playlists(db).create((record) => {
      record.name = input.name;
      record.normalizedName = normalizeName(input.name);
      record.description = input.description ?? null;
      record.isCollaborative = input.isCollaborative ?? false;
      record.version = 1;
      record.updatedAt = Date.now();
      record.createdAt = Date.now();
    });
    await enqueuePlaylistUpsertOp(db, playlist.id);
    return playlist;
  });
}

export async function renamePlaylist(db: Database, id: string, name: string): Promise<Playlist> {
  return db.write(async () => {
    const playlist = await playlists(db).find(id);
    const updated = await playlist.update((p) => {
      p.name = name;
      p.normalizedName = normalizeName(name);
      p.version += 1;
      p.updatedAt = Date.now();
    });
    await enqueuePlaylistUpsertOp(db, updated.id);
    return updated;
  });
}

export async function removePlaylist(db: Database, id: string): Promise<void> {
  await db.write(async () => {
    const playlist = await playlists(db).find(id);
    const baseVersion = playlist.version;
    await playlist.destroyPermanently();
    await enqueuePlaylistDeleteOp(db, id, baseVersion);
  });
}

export function playlistsQuery(
  db: Database,
  sort: PlaylistSort = 'name',
  search?: string,
): Query<Playlist> {
  let q = playlists(db).query();
  if (search && search.trim().length > 0) {
    q = q.extend(Q.where('normalized_name', Q.like(`%${normalizeName(search)}%`)));
  }
  return sort === 'recent'
    ? q.extend(Q.sortBy('updated_at', Q.desc))
    : q.extend(Q.sortBy('name', Q.asc));
}

export function playlistEntriesQuery(db: Database, playlistId: string): Query<PlaylistEntry> {
  return entries(db).query(Q.where('playlist_id', playlistId), Q.sortBy('position', Q.asc));
}

export async function addToPlaylist(
  db: Database,
  playlistId: string,
  trackId: string,
): Promise<void> {
  await db.write(async () => {
    const count = await playlistEntriesQuery(db, playlistId).fetchCount();
    await entries(db).create((entry) => {
      entry.playlistId = playlistId;
      entry.trackId = trackId;
      entry.position = count;
      entry.addedAt = Date.now();
    });
    await bumpPlaylistVersion(db, playlistId);
    await enqueuePlaylistUpsertOp(db, playlistId);
  });
}

export async function removeFromPlaylist(
  db: Database,
  playlistId: string,
  entryId: string,
): Promise<void> {
  await db.write(async () => {
    const entry = await entries(db).find(entryId);
    const position = entry.position;
    await entry.destroyPermanently();
    const rest = await playlistEntriesQuery(db, playlistId).fetch();
    await Promise.all(
      rest
        .filter((e) => e.position > position)
        .map((e) => e.update((entry) => (entry.position -= 1))),
    );
    await bumpPlaylistVersion(db, playlistId);
    await enqueuePlaylistUpsertOp(db, playlistId);
  });
}

export async function movePlaylistEntry(
  db: Database,
  playlistId: string,
  fromPosition: number,
  toPosition: number,
): Promise<void> {
  await db.write(async () => {
    const list = await playlistEntriesQuery(db, playlistId).fetch();
    if (
      fromPosition < 0 ||
      toPosition < 0 ||
      fromPosition >= list.length ||
      toPosition >= list.length
    ) {
      return;
    }
    const reordered = [...list];
    const [moved] = reordered.splice(fromPosition, 1);
    reordered.splice(toPosition, 0, moved!);
    await db.batch(
      ...reordered.map((entry, position) => entry.prepareUpdate((e) => (e.position = position))),
    );
    await bumpPlaylistVersion(db, playlistId);
    await enqueuePlaylistUpsertOp(db, playlistId);
  });
}

async function bumpPlaylistVersion(db: Database, playlistId: string): Promise<void> {
  const playlist = await playlists(db).find(playlistId);
  await playlist.update((p) => {
    p.version += 1;
    p.updatedAt = Date.now();
  });
}

/* ---------------------------------------------------------------- favorites */

export async function toggleFavorite(
  db: Database,
  targetType: FavoriteTarget,
  targetId: string,
  meta?: { title?: string; subtitle?: string },
): Promise<boolean> {
  return db.write(async () => {
    const existing =
      (
        await favorites(db)
          .query(Q.where('target_type', targetType), Q.where('target_id', targetId))
          .fetch()
      )[0] ?? null;
    if (existing) {
      await existing.destroyPermanently();
    } else {
      await favorites(db).create((favorite) => {
        favorite.targetType = targetType;
        favorite.targetId = targetId;
        favorite.title = meta?.title ?? null;
        favorite.subtitle = meta?.subtitle ?? null;
        favorite.createdAt = Date.now();
      });
    }
    await enqueueFavoriteToggleOp(db, targetType, targetId, {
      title: meta?.title ?? null,
      subtitle: meta?.subtitle ?? null,
    });
    return !existing;
  });
}

export async function isFavorite(
  db: Database,
  targetType: FavoriteTarget,
  targetId: string,
): Promise<boolean> {
  return Boolean(
    (
      await favorites(db)
        .query(Q.where('target_type', targetType), Q.where('target_id', targetId))
        .fetch()
    )[0],
  );
}

export function favoritesQuery(db: Database, targetType?: FavoriteTarget): Query<Favorite> {
  const q = targetType
    ? favorites(db).query(Q.where('target_type', targetType))
    : favorites(db).query();
  return q.extend(Q.sortBy('created_at', Q.desc));
}

/* ------------------------------------------------------------------ history */

export interface PlaybackRecordInput {
  trackId?: string | null;
  title?: string | null;
  artist?: string | null;
  positionMs?: number | null;
  durationMs?: number | null;
  sourceKind?: string | null;
  playedAt?: number;
}

export async function recordPlayback(
  db: Database,
  input: PlaybackRecordInput,
): Promise<HistoryEntry> {
  const { trackId, title, artist, positionMs, durationMs, sourceKind } = input;
  return db.write(async () => {
    if (trackId) {
      const prior = await history(db).query(Q.where('track_id', trackId)).fetch();
      if (prior.length > 0) {
        await Promise.all(prior.map((entry) => entry.destroyPermanently()));
      }
    }
    return history(db).create((entry) => {
      entry.trackId = trackId ?? null;
      entry.title = title ?? null;
      entry.artist = artist ?? null;
      entry.positionMs = positionMs ?? null;
      entry.durationMs = durationMs ?? null;
      entry.sourceKind = sourceKind ?? null;
      entry.playedAt = input.playedAt ?? Date.now();
    });
  });
}

export function historyQuery(db: Database, limit = 100): Query<HistoryEntry> {
  return history(db).query(Q.sortBy('played_at', Q.desc), Q.take(limit));
}

/* ---------------------------------------------------------- library search */

export interface LibrarySearchResult {
  tracks: Track[];
  artists: Artist[];
  albums: Album[];
}

export async function searchLibrary(db: Database, query: string): Promise<LibrarySearchResult> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { tracks: [], artists: [], albums: [] };
  }
  const term = `%${normalizeName(trimmed)}%`;
  const [trackList, artistList, albumList] = await Promise.all([
    tracks(db)
      .query(Q.where('normalized_title', Q.like(term)), Q.sortBy('title', Q.asc))
      .fetch(),
    artists(db)
      .query(Q.where('normalized_name', Q.like(term)), Q.sortBy('name', Q.asc))
      .fetch(),
    albums(db)
      .query(Q.where('normalized_title', Q.like(term)), Q.sortBy('title', Q.asc))
      .fetch(),
  ]);
  return { tracks: trackList, artists: artistList, albums: albumList };
}

/** Deterministic id generation kept in one place (used by tests too). */
export function nextId(): string {
  return createId();
}
