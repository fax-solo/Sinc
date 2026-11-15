import { describe, expect, it, vi } from 'vitest';
import { musicBrainz } from './musicbrainz';
import * as http from './http';

describe('musicbrainz provider', () => {
  it('searches artists and parses fields properly', async () => {
    vi.spyOn(http, 'providerFetchJson').mockResolvedValueOnce({
      artists: [
        {
          id: 'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d',
          name: 'The Beatles',
          'sort-name': 'Beatles, The',
          type: 'Group',
          country: 'GB',
          area: { name: 'United Kingdom' },
          disambiguation: 'John, Paul, George & Ringo',
          'life-span': { begin: '1960', end: '1970', ended: true },
          tags: [{ name: 'rock', count: 10 }],
          aliases: [{ name: 'Fab Four' }],
        },
      ],
    });

    const results = await musicBrainz.searchArtist('The Beatles', 1);
    expect(results).toHaveLength(1);
    const first = results[0]!;
    expect(first.id).toBe('b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d');
    expect(first.name).toBe('The Beatles');
    expect(first.country).toBe('GB');
    expect(first.aliases).toContain('Fab Four');
    expect(first.genres).toContain('rock');
    expect(first.externalLinks.musicbrainz).toContain('b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d');
  });

  it('looks up artist relationships and extracts Spotify/Deezer/Wikidata links', async () => {
    vi.spyOn(http, 'providerFetchJson').mockResolvedValueOnce({
      id: 'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d',
      name: 'The Beatles',
      relations: [
        {
          type: 'spotify',
          url: { resource: 'https://open.spotify.com/artist/3WrFJ7ztbogyGnTHbHJFl2' },
        },
        {
          type: 'deezer',
          url: { resource: 'https://www.deezer.com/artist/1' },
        },
        {
          type: 'wikidata',
          url: { resource: 'https://www.wikidata.org/wiki/Q1299' },
        },
      ],
      tags: [{ name: 'classic rock' }],
    });

    const artist = await musicBrainz.lookupArtist('b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d');
    expect(artist).not.toBeNull();
    expect(artist?.externalLinks.spotify).toBe('https://open.spotify.com/artist/3WrFJ7ztbogyGnTHbHJFl2');
    expect(artist?.externalLinks.deezer).toBe('https://www.deezer.com/artist/1');
    expect(artist?.externalLinks.wikidata).toBe('https://www.wikidata.org/wiki/Q1299');
    expect(artist?.genres).toContain('classic rock');
  });

  it('handles network errors gracefully without throwing', async () => {
    vi.spyOn(http, 'providerFetchJson').mockRejectedValueOnce(new Error('Network failure'));
    const results = await musicBrainz.searchArtist('CrashTest');
    expect(results).toEqual([]);

    vi.spyOn(http, 'providerFetchJson').mockRejectedValueOnce(new Error('503 Service Unavailable'));
    const artist = await musicBrainz.lookupArtist('invalid-id');
    expect(artist).toBeNull();
  });
});
