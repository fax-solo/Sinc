import { beforeEach, describe, expect, it, vi } from 'vitest';
import { musicApi } from './musicApi';
import { deezer } from '../providers/deezer';
import { itunes } from '../providers/itunes';
import type { CanonicalAlbum, CanonicalArtist, CanonicalTrack, CanonicalPlaylist } from '@sinc/shared';

describe('unifiedSearch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('combines and deduplicates artist results across Deezer and iTunes', async () => {
    const itunesArtist: CanonicalArtist = {
      id: 'itunes:100',
      name: 'Daft Punk',
      providerIds: { itunes: '100' },
      genres: ['Electronic'],
    };
    const deezerArtist: CanonicalArtist = {
      id: 'deezer:27',
      name: 'Daft Punk',
      providerIds: { deezer: '27' },
      genres: ['Electronic'],
      artworkUrl: 'https://example.com/daftpunk.jpg',
    };

    vi.spyOn(itunes, 'searchArtists').mockResolvedValue([itunesArtist]);
    vi.spyOn(deezer, 'searchArtists').mockResolvedValue([deezerArtist]);

    const res = await musicApi.search('Daft Punk', 'artists');
    expect(res.artists?.data).toHaveLength(1);
    const merged = res.artists!.data[0]!;
    expect(merged.name).toBe('Daft Punk');
    expect(merged.providerIds.itunes).toBe('100');
    expect(merged.providerIds.deezer).toBe('27');
    expect(merged.artworkUrl).toBe('https://example.com/daftpunk.jpg');
  });

  it('combines and deduplicates album results across Deezer and iTunes', async () => {
    const itunesAlbum: CanonicalAlbum = {
      id: 'itunes:al1',
      title: 'Random Access Memories',
      artist: { id: 'itunes:1', name: 'Daft Punk', providerIds: {}, genres: [] },
      trackCount: 13,
      providerIds: { itunes: 'al1' },
      type: 'album',
      releaseDate: '2013-05-17',
    };
    const deezerAlbum: CanonicalAlbum = {
      id: 'deezer:al2',
      title: 'Random Access Memories',
      artist: { id: 'deezer:2', name: 'Daft Punk', providerIds: {}, genres: [] },
      trackCount: 13,
      providerIds: { deezer: 'al2' },
      type: 'album',
      artworkUrl: 'https://example.com/ram.jpg',
    };

    vi.spyOn(itunes, 'searchAlbums').mockResolvedValue([itunesAlbum]);
    vi.spyOn(deezer, 'searchAlbums').mockResolvedValue([deezerAlbum]);

    const res = await musicApi.search('Random Access Memories', 'albums');
    expect(res.albums?.data).toHaveLength(1);
    const merged = res.albums!.data[0]!;
    expect(merged.title).toBe('Random Access Memories');
    expect(merged.providerIds.itunes).toBe('al1');
    expect(merged.providerIds.deezer).toBe('al2');
    expect(merged.artworkUrl).toBe('https://example.com/ram.jpg');
  });

  it('delivers partial results when one provider fails or times out', async () => {
    const itunesTrack: CanonicalTrack = {
      id: 'itunes:t1',
      title: 'Get Lucky',
      artists: [{ id: 'itunes:1', name: 'Daft Punk', providerIds: {}, genres: [] }],
      durationMs: 240000,
      providerIds: { itunes: 't1' },
      explicit: false,
    };

    // Deezer throws network failure, iTunes succeeds
    vi.spyOn(deezer, 'searchTracks').mockRejectedValue(new Error('Deezer offline'));
    vi.spyOn(itunes, 'searchTracks').mockResolvedValue([itunesTrack]);

    const res = await musicApi.search('Get Lucky', 'tracks');
    expect(res.tracks?.data).toHaveLength(1);
    expect(res.tracks!.data[0]!.track.title).toBe('Get Lucky');
  });

  it('searches and returns public provider playlists', async () => {
    const deezerPl: CanonicalPlaylist = {
      id: 'deezer:pl1',
      name: 'Electro Hits',
      artworkUrl: 'https://example.com/pl.jpg',
      owner: { id: 'deezer:1', name: 'Deezer Editor' },
      isCollaborative: false,
      trackCount: 40,
      providerIds: { deezer: 'pl1' },
      createdAt: '',
      updatedAt: '',
    };

    vi.spyOn(deezer, 'searchPlaylists').mockResolvedValue([deezerPl]);
    vi.spyOn(itunes, 'searchPlaylists').mockResolvedValue([]);

    const res = await musicApi.search('Electro', 'playlists');
    expect(res.playlists?.data).toHaveLength(1);
    expect(res.playlists!.data[0]!.name).toBe('Electro Hits');
    expect(res.playlists!.data[0]!.owner.name).toBe('Deezer Editor');
  });
});
