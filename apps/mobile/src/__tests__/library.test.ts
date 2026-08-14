import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { librarySchema } from '../db/schema';
import { createDatabase } from '../db/database';

vi.mock('@nozbe/watermelondb/adapters/sqlite', () => ({ default: class SQLiteAdapterMock {} }));
import {
  addToPlaylist,
  albumsQuery,
  artistsQuery,
  createPlaylist,
  favoritesQuery,
  historyQuery,
  isFavorite,
  movePlaylistEntry,
  playlistEntriesQuery,
  playlistsQuery,
  recordPlayback,
  removeFromPlaylist,
  removePlaylist,
  renamePlaylist,
  saveAlbum,
  saveArtist,
  saveTrack,
  searchLibrary,
  toggleFavorite,
  tracksQuery,
} from '../db/repositories';

function makeDb(name: string): Database {
  return createDatabase(
    new LokiJSAdapter({
      dbName: name,
      schema: librarySchema,
      useWebWorker: false,
      useIncrementalIndexedDB: true,
    }),
  );
}

describe('library repositories (LokiJS)', () => {
  let db: Database;

  beforeEach(() => {
    db = makeDb(`test-${Math.random().toString(36).slice(2)}`);
  });

  describe('tracks', () => {
    it('creates and upserts tracks by provider id', async () => {
      const first = await saveTrack(db, {
        title: 'Bohemian Rhapsody',
        providerId: 'mb-1',
        sourceKind: 'REMOTE',
        durationMs: 354_000,
      });
      expect(first.title).toBe('Bohemian Rhapsody');
      expect(first.providerId).toBe('mb-1');

      const updated = await saveTrack(db, {
        title: 'Bohemian Rhapsody (Live)',
        providerId: 'mb-1',
        sourceKind: 'REMOTE',
        durationMs: 400_000,
      });
      expect(updated.id).toBe(first.id);
      expect(updated.title).toBe('Bohemian Rhapsody (Live)');
      expect(await tracksQuery(db).fetchCount()).toBe(1);
    });

    it('sorts by title, artist and recency', async () => {
      await saveTrack(db, { title: 'Zebra', sourceKind: 'LOCAL', addedAt: 0 });
      await saveTrack(db, { title: 'Alpha', sourceKind: 'LOCAL', addedAt: 1000 });
      await saveTrack(db, { title: 'Mid', sourceKind: 'LOCAL', addedAt: 2000 });

      const byTitle = await tracksQuery(db, 'title').fetch();
      expect(byTitle.map((t) => t.title)).toEqual(['Alpha', 'Mid', 'Zebra']);

      const recent = await tracksQuery(db, 'recent').fetch();
      expect(recent[0]?.title).toBe('Mid');
    });

    it('searches by normalized title (case-insensitive)', async () => {
      await saveTrack(db, { title: 'Hotel California', sourceKind: 'LOCAL' });
      await saveTrack(db, { title: 'California Dreamin', sourceKind: 'LOCAL' });
      await saveTrack(db, { title: 'New York', sourceKind: 'LOCAL' });

      const hits = await tracksQuery(db, 'title', 'california').fetch();
      expect(hits.map((t) => t.title).sort()).toEqual(['California Dreamin', 'Hotel California']);
    });
  });

  describe('artists and albums', () => {
    it('upserts artists by provider id and sorts', async () => {
      const a = await saveArtist(db, { name: 'Ziggy', providerId: 'mb-a1' });
      await saveArtist(db, { name: 'Amy', providerId: 'mb-a2' });
      await saveArtist(db, { name: 'Ziggy' }); // new artist without provider
      expect(await artistsQuery(db).fetchCount()).toBe(3);
      const sorted = await artistsQuery(db, 'name').fetch();
      expect(sorted.map((x) => x.name)).toEqual(['Amy', 'Ziggy', 'Ziggy']);
      const again = await saveArtist(db, { name: 'Ziggy Jr', providerId: 'mb-a1' });
      expect(again.id).toBe(a.id);
    });

    it('upserts albums and queries with artist sort', async () => {
      const artist = await saveArtist(db, { name: 'Artist X', providerId: 'mb-x' });
      await saveAlbum(db, { title: 'Omega', artistId: artist.id, providerId: 'mb-al1' });
      await saveAlbum(db, { title: 'Alpha', artistId: artist.id, providerId: 'mb-al2' });
      const sorted = await albumsQuery(db, 'artist').fetch();
      expect(sorted.map((x) => x.title)).toEqual(['Alpha', 'Omega']);
      const search = await albumsQuery(db, 'title', 'ome').fetch();
      expect(search.map((x) => x.title)).toEqual(['Omega']);
    });
  });

  describe('playlists', () => {
    it('creates, renames, removes and sorts playlists', async () => {
      const p = await createPlaylist(db, { name: 'Road Trip' });
      expect(p.version).toBe(1);
      const renamed = await renamePlaylist(db, p.id, 'Road Trip 2');
      expect(renamed.version).toBe(2);
      await createPlaylist(db, { name: 'AA' });
      const sorted = await playlistsQuery(db, 'name').fetch();
      expect(sorted.map((x) => x.name)).toEqual(['AA', 'Road Trip 2']);
      await removePlaylist(db, p.id);
      expect(await playlistsQuery(db).fetchCount()).toBe(1);
    });

    it('adds entries at the tail and bumps the version', async () => {
      const p = await createPlaylist(db, { name: 'Mix' });
      const t1 = await saveTrack(db, { title: 'One', sourceKind: 'LOCAL' });
      const t2 = await saveTrack(db, { title: 'Two', sourceKind: 'LOCAL' });
      await addToPlaylist(db, p.id, t1.id);
      await addToPlaylist(db, p.id, t2.id);
      const list = await playlistEntriesQuery(db, p.id).fetch();
      expect(list.map((e) => e.trackId)).toEqual([t1.id, t2.id]);
      expect(list.map((e) => e.position)).toEqual([0, 1]);
      expect(
        (await db.collections.get<import('../db/models').Playlist>('playlists').find(p.id)).version,
      ).toBe(3);
    });

    it('moves entries and renumbers positions', async () => {
      const p = await createPlaylist(db, { name: 'Mix' });
      const t1 = await saveTrack(db, { title: 'One', sourceKind: 'LOCAL' });
      const t2 = await saveTrack(db, { title: 'Two', sourceKind: 'LOCAL' });
      const t3 = await saveTrack(db, { title: 'Three', sourceKind: 'LOCAL' });
      await addToPlaylist(db, p.id, t1.id);
      await addToPlaylist(db, p.id, t2.id);
      await addToPlaylist(db, p.id, t3.id);
      await movePlaylistEntry(db, p.id, 0, 2);
      const list = await playlistEntriesQuery(db, p.id).fetch();
      expect(list.map((e) => e.position)).toEqual([0, 1, 2]);
      expect(list[0]?.trackId).toBe(t2.id);
      expect(list[2]?.trackId).toBe(t1.id);
    });

    it('removes entries and closes the position gap', async () => {
      const p = await createPlaylist(db, { name: 'Mix' });
      const t1 = await saveTrack(db, { title: 'One', sourceKind: 'LOCAL' });
      const t2 = await saveTrack(db, { title: 'Two', sourceKind: 'LOCAL' });
      const t3 = await saveTrack(db, { title: 'Three', sourceKind: 'LOCAL' });
      await addToPlaylist(db, p.id, t1.id);
      const e2 = await addToPlaylistGetEntry(db, p.id, t2.id);
      await addToPlaylist(db, p.id, t3.id);
      await removeFromPlaylist(db, p.id, e2);
      const list = await playlistEntriesQuery(db, p.id).fetch();
      expect(list.map((e) => e.trackId)).toEqual([t1.id, t3.id]);
      expect(list.map((e) => e.position)).toEqual([0, 1]);
    });
  });

  describe('favorites', () => {
    it('toggles on and off with metadata', async () => {
      expect(await isFavorite(db, 'track', 't1')).toBe(false);
      expect(await toggleFavorite(db, 'track', 't1', { title: 'Hit', subtitle: 'Artist' })).toBe(
        true,
      );
      expect(await isFavorite(db, 'track', 't1')).toBe(true);
      expect(await toggleFavorite(db, 'track', 't1')).toBe(false);
      expect(await isFavorite(db, 'track', 't1')).toBe(false);
    });

    it('filters favorites by target type', async () => {
      await toggleFavorite(db, 'track', 't1', { title: 'Song' });
      await toggleFavorite(db, 'artist', 'a1', { title: 'Band' });
      await toggleFavorite(db, 'album', 'al1', { title: 'LP' });
      const all = await favoritesQuery(db).fetch();
      expect(all).toHaveLength(3);
      const tracks = await favoritesQuery(db, 'track').fetch();
      expect(tracks).toHaveLength(1);
      expect(tracks[0]?.title).toBe('Song');
    });
  });

  describe('history', () => {
    it('records plays, dedupes per track and orders most recent first', async () => {
      await recordPlayback(db, { trackId: 't1', title: 'Old', playedAt: 1000 });
      await recordPlayback(db, { trackId: 't2', title: 'New', playedAt: 3000 });
      await recordPlayback(db, { trackId: 't1', title: 'Old again', playedAt: 4000 });
      const rows = await historyQuery(db, 10).fetch();
      expect(rows.map((r) => r.trackId)).toEqual(['t1', 't2']);
      expect(rows[0]?.title).toBe('Old again');
      expect(rows[0]?.playedAt).toBe(4000);
    });

    it('honors the limit', async () => {
      for (let i = 0; i < 5; i += 1) {
        await recordPlayback(db, { trackId: `t${i}`, playedAt: i });
      }
      expect(await historyQuery(db, 3).fetch()).toHaveLength(3);
    });
  });

  describe('library search', () => {
    it('searches across tracks, artists and albums', async () => {
      await saveTrack(db, { title: 'Blue Skies', sourceKind: 'LOCAL' });
      await saveArtist(db, { name: 'Blue Note', providerId: 'mb-n' });
      await saveAlbum(db, { title: 'Blue Album', providerId: 'mb-al' });
      const found = await searchLibrary(db, 'blue');
      expect(found.tracks.map((t) => t.title)).toEqual(['Blue Skies']);
      expect(found.artists.map((a) => a.name)).toEqual(['Blue Note']);
      expect(found.albums.map((a) => a.title)).toEqual(['Blue Album']);
      expect(await searchLibrary(db, '   ')).toEqual({ tracks: [], artists: [], albums: [] });
    });
  });
});

async function addToPlaylistGetEntry(
  db: Database,
  playlistId: string,
  trackId: string,
): Promise<string> {
  await addToPlaylist(db, playlistId, trackId);
  const list = await playlistEntriesQuery(db, playlistId).fetch();
  return list[list.length - 1]!.id;
}
