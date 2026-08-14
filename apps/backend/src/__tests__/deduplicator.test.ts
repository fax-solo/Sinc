import { describe, it, expect } from 'vitest';
import { Deduplicator } from '../domain/catalog/deduplicator.js';
import {
  completenessScore,
  extractVersion,
  toCanonicalArtist,
  toCanonicalTrack,
} from '../domain/catalog/normalize.js';

const raw = (overrides: Record<string, unknown> = {}) => ({
  provider: 'musicbrainz',
  providerId: 'rec-1',
  title: 'Hotel California',
  artistNames: ['Eagles'],
  ...overrides,
});

describe('completenessScore', () => {
  it('rewards rich metadata', () => {
    const rich = raw({
      isrc: 'X',
      durationMs: 391000,
      albumTitle: 'HC',
      artworkUrl: 'http://x',
      releaseDate: '1976',
    });
    const poor = raw({});
    expect(completenessScore(rich)).toBeGreaterThan(completenessScore(poor));
  });
});

describe('extractVersion', () => {
  it('extracts parenthetical suffixes', () => {
    expect(extractVersion('Song (Remix)')).toBe('Remix');
    expect(extractVersion('Song (Live at Wembley)')).toBe('Live at Wembley');
  });

  it('extracts dash version suffixes for known kinds', () => {
    expect(extractVersion('Song - Acoustic')).toBe('Acoustic');
    expect(extractVersion('Song - Other')).toBeUndefined();
  });

  it('returns undefined for plain titles', () => {
    expect(extractVersion('Hotel California')).toBeUndefined();
  });
});

describe('toCanonicalTrack', () => {
  it('maps provider fields into canonical shape', () => {
    const track = toCanonicalTrack(
      raw({ isrc: 'USMC17638786', durationMs: 391000, albumTitle: 'Hotel California' }),
    );
    expect(track.title).toBe('Hotel California');
    expect(track.artists.map((a) => a.name)).toEqual(['Eagles']);
    expect(track.album?.title).toBe('Hotel California');
    expect(track.isrc).toBe('USMC17638786');
    expect(track.durationMs).toBe(391000);
    expect(track.providerIds).toEqual({ musicbrainz: 'rec-1' });
    expect(track.providerConfidence).toBe(0.95);
    expect(track.normalizedTitle).toBe('hotel california');
  });

  it('carries version from the raw field and title suffix', () => {
    expect(toCanonicalTrack(raw({ version: 'Remix' })).version).toBe('Remix');
    expect(toCanonicalTrack(raw({ title: 'Song (Acoustic)' })).version).toBe('Acoustic');
  });
});

describe('toCanonicalArtist', () => {
  it('maps name variants and genres', () => {
    const artist = toCanonicalArtist({
      provider: 'musicbrainz',
      providerId: 'a1',
      name: 'The Eagles',
      nameVariants: ['Eagles'],
      genres: ['rock'],
    });
    expect(artist.normalizedName).toBe('eagles');
    expect(artist.nameVariants).toEqual(['Eagles']);
    expect(artist.genres).toEqual(['rock']);
    expect(artist.providerIds).toEqual({ musicbrainz: 'a1' });
  });
});

describe('Deduplicator', () => {
  const dedup = new Deduplicator();

  it('keeps unrelated tracks separate', () => {
    const results = [
      raw({ title: 'Hotel California', artistNames: ['Eagles'] }),
      raw({ title: 'New Kid in Town', artistNames: ['Eagles'] }),
    ];
    expect(dedup.deduplicate(results)).toHaveLength(2);
  });

  it('deduplicates by shared ISRC even with different titles', () => {
    const results = [
      raw({ isrc: 'USMC17638786' }),
      raw({ isrc: 'usmc17638786', title: 'Hotel California (Remastered)' }),
    ];
    const track = dedup.deduplicate(results)[0]!;
    expect(track.providerIds).toEqual({ musicbrainz: 'rec-1' });
  });

  it('deduplicates by fingerprint when ISRC is missing', () => {
    const results = [
      raw({
        provider: 'musicbrainz',
        providerId: 'a',
        title: 'Hotel California',
        artistNames: ['Eagles'],
      }),
      raw({
        provider: 'lastfm',
        providerId: 'b',
        title: 'Hotel California (Remix)',
        artistNames: ['The Eagles'],
      }),
    ];
    const track = dedup.deduplicate(results)[0]!;
    expect(Object.keys(track.providerIds)).toEqual(['musicbrainz', 'lastfm']);
    expect(track.providerIds.lastfm).toBe('b');
  });

  it('merges 5 providers reporting the same track into 1', () => {
    const results = [
      raw({
        provider: 'musicbrainz',
        providerId: 'mb1',
        isrc: 'USMC17638786',
        durationMs: 391000,
        albumTitle: 'Hotel California',
        trackNumber: 1,
      }),
      raw({ provider: 'lastfm', providerId: 'lf1', isrc: 'USMC17638786', durationMs: 391500 }),
      raw({
        provider: 'deezer',
        providerId: 'dz1',
        isrc: 'usmc17638786',
        durationMs: 391200,
        albumTitle: 'Hotel California',
        artworkUrl: 'http://art',
      }),
      raw({
        provider: 'itunes',
        providerId: 'it1',
        isrc: 'USMC17638786',
        durationMs: 391000,
        version: 'Remaster',
      }),
      raw({
        provider: 'musicbrainz',
        providerId: 'mb2',
        title: 'Hotel California',
        durationMs: 391000,
      }),
    ];
    const tracks = dedup.deduplicate(results);
    expect(tracks).toHaveLength(1);
    const track = tracks[0]!;
    expect(Object.keys(track.providerIds).sort()).toEqual([
      'deezer',
      'itunes',
      'lastfm',
      'musicbrainz',
    ]);
    expect(track.isrc).toBe('USMC17638786');
    expect(track.artworkUrl).toBe('http://art');
  });

  it('prefers the most complete record as representative', () => {
    const poor = raw({ providerId: 'p1' });
    const rich = raw({
      providerId: 'p2',
      isrc: 'X',
      durationMs: 391000,
      albumTitle: 'HC',
      releaseDate: '1976',
    });
    const track = dedup.deduplicate([poor, rich])[0]!;
    expect(track.providerIds.musicbrainz).toBe('p2');
    expect(track.releaseDate).toBe('1976');
  });

  it('resolves duration ties to the group median', () => {
    const results = [
      raw({ providerId: 'a', durationMs: 391000 }),
      raw({ providerId: 'b', durationMs: 400000 }),
      raw({ providerId: 'c', durationMs: 391100 }),
    ];
    const track = dedup.deduplicate(results)[0]!;
    expect(track.durationMs).toBe(391100);
  });

  it('returns a deterministic order for equal candidates', () => {
    const results = [raw({ providerId: 'b' }), raw({ providerId: 'a' })];
    const track = dedup.deduplicate(results)[0]!;
    expect(track.providerIds.musicbrainz).toBe('a');
  });

  it('survives empty and single inputs', () => {
    expect(dedup.deduplicate([])).toEqual([]);
    const track = dedup.deduplicate([raw()])[0]!;
    expect(track.title).toBe('Hotel California');
  });
});
