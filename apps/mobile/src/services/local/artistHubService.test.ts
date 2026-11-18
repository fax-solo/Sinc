import { beforeEach, describe, expect, it, vi } from 'vitest';
import { artistHubService } from './artistHubService';
import { deezer } from '../providers/deezer';
import { musicBrainz } from '../providers/musicbrainz';
import { lastFm } from '../providers/lastfm';
import { useLibraryStore } from '../library/libraryStore';
import type { CanonicalAlbum, CanonicalArtist, CanonicalTrack } from '@sinc/shared';

describe('artistHubService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('aggregates multi-provider metadata into a comprehensive ArtistDetail profile', async () => {
    const mockDeezerArtist: CanonicalArtist = {
      id: 'deezer:27',
      name: 'Daft Punk',
      artworkUrl: 'https://e-cdns-images.dzcdn.net/images/artist/27/500x500.jpg',
      providerIds: { deezer: '27' },
      genres: ['Electronic', 'Dance'],
    };

    const mockAlbums: CanonicalAlbum[] = [
      {
        id: 'deezer:101',
        title: 'Discovery',
        artist: mockDeezerArtist,
        trackCount: 14,
        providerIds: { deezer: '101' },
        type: 'album',
        releaseDate: '2001-03-12',
      },
      {
        id: 'deezer:102',
        title: 'One More Time',
        artist: mockDeezerArtist,
        trackCount: 3,
        providerIds: { deezer: '102' },
        type: 'single',
        releaseDate: '2000-11-13',
      },
    ];

    const mockTracks: CanonicalTrack[] = [
      {
        id: 'deezer:1001',
        title: 'Harder, Better, Faster, Stronger',
        artists: [mockDeezerArtist],
        durationMs: 224000,
        providerIds: { deezer: '1001' },
        explicit: false,
      },
    ];

    vi.spyOn(deezer, 'lookupArtistDetailed').mockResolvedValueOnce({
      artist: mockDeezerArtist,
      fans: 4500000,
      link: 'https://www.deezer.com/artist/27',
      topTracks: mockTracks,
      discography: {
        albums: [mockAlbums[0]!],
        singles: [mockAlbums[1]!],
        eps: [],
        compilations: [],
      },
      relatedArtists: [{ id: 'deezer:88', name: 'Justice', providerIds: { deezer: '88' }, genres: ['Electronic'] }],
      playlists: [
        {
          id: 'deezer:999',
          name: '100% Daft Punk',
          owner: { id: 'deezer:1', name: 'Deezer' },
          isCollaborative: false,
          trackCount: 50,
          providerIds: { deezer: '999' },
          createdAt: '',
          updatedAt: '',
        },
      ],
    });

    vi.spyOn(musicBrainz, 'searchArtist').mockResolvedValueOnce([
      {
        id: '056e4f3e-d505-4dad-8ec1-d04f521cbb56',
        name: 'Daft Punk',
        country: 'FR',
        genres: ['electronic', 'french house'],
        externalLinks: {
          spotify: 'https://open.spotify.com/artist/4tZwfgrHOc3mvqYxwDoOD1',
          musicbrainz: 'https://musicbrainz.org/artist/056e4f3e-d505-4dad-8ec1-d04f521cbb56',
        },
      },
    ]);

    vi.spyOn(musicBrainz, 'lookupArtist').mockResolvedValueOnce({
      id: '056e4f3e-d505-4dad-8ec1-d04f521cbb56',
      name: 'Daft Punk',
      country: 'FR',
      lifeSpan: { begin: '1993', end: '2021', ended: true },
      genres: ['electronic', 'french house'],
      externalLinks: {
        spotify: 'https://open.spotify.com/artist/4tZwfgrHOc3mvqYxwDoOD1',
        deezer: 'https://www.deezer.com/artist/27',
        musicbrainz: 'https://musicbrainz.org/artist/056e4f3e-d505-4dad-8ec1-d04f521cbb56',
      },
    });

    vi.spyOn(lastFm, 'getArtistInfo').mockResolvedValueOnce({
      name: 'Daft Punk',
      listeners: 4200000,
      playCount: 210000000,
      bioSummary: 'Daft Punk were a French electronic music duo formed in 1993 in Paris.',
      tags: ['electronic', 'dance'],
      similarArtists: ['Justice'],
    });

    const detail = await artistHubService.getArtistDetail('deezer:27', 'Daft Punk', {
      forceRefresh: true,
    });

    expect(detail).not.toBeNull();
    expect(detail.artist.name).toBe('Daft Punk');
    expect(detail.artist.providerIds.deezer).toBe('27');
    expect(detail.artist.providerIds.musicbrainz).toBe('056e4f3e-d505-4dad-8ec1-d04f521cbb56');
    expect(detail.isVerified).toBe(true);

    // Verified Spotify link from MusicBrainz
    expect(detail.externalLinks.spotify).toBe('https://open.spotify.com/artist/4tZwfgrHOc3mvqYxwDoOD1');
    expect(detail.externalLinks.deezer).toBe('https://www.deezer.com/artist/27');

    // Statistics attribution
    expect(detail.statistics.deezerFans).toBe(4500000);
    expect(detail.statistics.lastFmListeners).toBe(4200000);
    expect(detail.statistics.sourceProviders).toContain('Deezer');
    expect(detail.statistics.sourceProviders).toContain('MusicBrainz');
    expect(detail.statistics.sourceProviders).toContain('Last.fm');

    // Discography categorized
    expect(detail.discography.albums).toHaveLength(1);
    expect(detail.discography.albums[0]?.title).toBe('Discovery');
    expect(detail.discography.singles).toHaveLength(1);
    expect(detail.discography.singles[0]?.title).toBe('One More Time');

    // Similar artists
    expect(detail.relatedArtists).toHaveLength(1);
    expect(detail.relatedArtists[0]?.name).toBe('Justice');

    // Playlists
    expect(detail.playlists.some((p) => p.name === '100% Daft Punk')).toBe(true);
  });

  it('associates local library playlists containing the artist', async () => {
    const artistName = 'Radiohead';
    useLibraryStore.setState({
      playlists: [
        {
          id: 'local_pl_1',
          name: 'My 90s Alternative',
          description: 'Best of 90s',
          coverArtworkUrl: undefined,
          tracks: [
            {
              id: 'itunes:9001',
              title: 'Karma Police',
              artists: [{ id: 'itunes:1', name: 'Radiohead', providerIds: {}, genres: [] }],
              durationMs: 260000,
              providerIds: {},
              explicit: false,
            },
          ],
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
    });

    vi.spyOn(deezer, 'searchArtists').mockResolvedValueOnce([]);
    vi.spyOn(musicBrainz, 'searchArtist').mockResolvedValueOnce([]);
    vi.spyOn(lastFm, 'getArtistInfo').mockResolvedValueOnce(null);

    const detail = await artistHubService.getArtistDetail('itunes:1', artistName, {
      forceRefresh: true,
    });

    expect(detail.playlists.some((p) => p.name === 'My 90s Alternative')).toBe(true);
  });
});
