import { describe, expect, it } from 'vitest';
import { areSameArtist, deduplicateArtists } from './artistIdentity';
import type { CanonicalArtist } from '@sinc/shared';

describe('artistIdentity', () => {
  it('matches artists with identical provider IDs', () => {
    const a = { name: 'Daft Punk', providerIds: { deezer: '27' } };
    const b = { name: 'Random Name', providerIds: { deezer: '27' } };
    expect(areSameArtist(a, b)).toBe(true);
  });

  it('matches artists with shared external URLs', () => {
    const a = {
      name: 'Radiohead',
      providerIds: {},
      externalUrls: ['https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb'],
    };
    const b = {
      name: 'Radiohead UK',
      providerIds: {},
      externalUrls: ['https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb'],
    };
    expect(areSameArtist(a, b)).toBe(true);
  });

  it('matches aliases', () => {
    const a = {
      name: 'Childish Gambino',
      providerIds: {},
      aliases: ['Donald Glover'],
    };
    const b = {
      name: 'Donald Glover',
      providerIds: {},
    };
    expect(areSameArtist(a, b)).toBe(true);
  });

  it('DOES NOT merge different artists with the same name if disambiguation conflicts', () => {
    const band = {
      name: 'Genesis',
      providerIds: {},
      disambiguation: 'English rock band formed in 1967',
      genres: ['Progressive Rock'],
    };
    const solo = {
      name: 'Genesis',
      providerIds: {},
      disambiguation: 'US hip-hop producer',
      genres: ['Hip-Hop'],
    };
    expect(areSameArtist(band, solo)).toBe(false);
  });

  it('DOES NOT merge artists with completely disjoint genres and countries', () => {
    const a = {
      name: 'Nirvana',
      country: 'GB',
      genres: ['Progressive Rock', 'Psychedelic Rock'],
      providerIds: {},
    };
    const b = {
      name: 'Nirvana',
      country: 'US',
      genres: ['Grunge', 'Alternative Rock'],
      providerIds: {},
    };
    expect(areSameArtist(a, b)).toBe(false);
  });

  it('deduplicates a list of CanonicalArtists, merging providerIds without losing distinct artists', () => {
    const list: CanonicalArtist[] = [
      {
        id: 'itunes:1',
        name: 'The Beatles',
        providerIds: { itunes: '1' },
        genres: ['Rock'],
        artworkUrl: 'https://example.com/beatles1.jpg',
      },
      {
        id: 'deezer:2',
        name: 'The Beatles',
        providerIds: { deezer: '2' },
        genres: ['Pop/Rock'],
      },
      {
        id: 'itunes:99',
        name: 'Queen',
        providerIds: { itunes: '99' },
        genres: ['Rock'],
      },
    ];

    const deduped = deduplicateArtists(list);
    expect(deduped.length).toBe(2);

    const beatles = deduped.find((a) => a.name === 'The Beatles');
    expect(beatles).toBeDefined();
    expect(beatles?.providerIds.itunes).toBe('1');
    expect(beatles?.providerIds.deezer).toBe('2');
    expect(beatles?.artworkUrl).toBe('https://example.com/beatles1.jpg');
    expect(beatles?.genres).toContain('Rock');
    expect(beatles?.genres).toContain('Pop/Rock');
  });
});
