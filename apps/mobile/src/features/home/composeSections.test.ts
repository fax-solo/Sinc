import { describe, expect, it } from 'vitest';
import type { CanonicalAlbum, CanonicalArtist, CanonicalPlaylist, CanonicalTrack } from '@sinc/shared';
import type { DailyMix, HomeSection } from '../../services/local/musicApi';
import { composeHomeSections, filterFeedbackSections } from './useHomeFeed';

function track(id: string, artist = `Artist ${id}`): CanonicalTrack {
  return {
    id,
    title: `Track ${id}`,
    artists: [{ id: `artist:${artist}`, name: artist, providerIds: {}, genres: [] }],
    durationMs: 1000,
    providerIds: {},
    explicit: false,
  };
}

function playlist(id: string): CanonicalPlaylist {
  return {
    id,
    name: `Playlist ${id}`,
    owner: { id: 'owner', name: 'Owner' },
    isCollaborative: false,
    trackCount: 2,
    providerIds: {},
    createdAt: '',
    updatedAt: '',
  };
}

function artist(name: string): CanonicalArtist {
  return { id: `artist:${name}`, name, providerIds: {}, genres: [] };
}

function album(id: string, artistName: string): CanonicalAlbum {
  return {
    id,
    title: `Album ${id}`,
    artist: artist(artistName),
    trackCount: 1,
    providerIds: {},
    type: 'album',
  };
}

function mix(id: string): DailyMix {
  return {
    id,
    name: `Mix ${id}`,
    kind: 'daily',
    genre: 'Pop',
    trackCount: 1,
    tracks: [track(`mix-${id}`)],
  };
}

const mixes = (id: string): HomeSection => ({
  kind: 'mixes',
  title: 'Made for you',
  mixes: [mix(id)],
});

const tracks = (title: string, ids: string[]): HomeSection => ({
  kind: 'tracks',
  title,
  tracks: ids.map((id) => track(id)),
});

const recent = (ids: string[]): HomeSection => ({
  kind: 'recently-played',
  title: 'Recently played',
  tracks: ids.map((id) => track(id)),
});

const quickAccess = (ids: string[]): HomeSection => ({
  kind: 'quick-access',
  title: 'Your playlists',
  playlists: ids.map(playlist),
});

describe('composeHomeSections', () => {
  it('leads with personal mixes and puts local owned rails before recommendations', () => {
    const sections = composeHomeSections(
      [
        mixes('personal'),
        tracks('Jump back in', ['p1']),
        tracks('Saved for you', ['download']),
        recent(['personal-recent']),
        quickAccess(['personal-playlist']),
      ],
      [recent(['local-recent']), quickAccess(['local-playlist']), tracks('Saved for you', ['download'])],
      [mixes('global'), tracks('Trending songs', ['chart'])]
    );

    expect(sections.map((section) => section.title)).toEqual([
      'Made for you',
      'Recently played',
      'Your playlists',
      'Saved for you',
      'Jump back in',
    ]);
    expect(sections[0]).toMatchObject({ kind: 'mixes', mixes: [{ id: 'personal' }] });
    expect(sections[1]).toMatchObject({ tracks: [{ id: 'local-recent' }] });
    expect(sections[2]).toMatchObject({ playlists: [{ id: 'local-playlist' }] });
    // Optimistic duplicate download rail is replaced by the local one, not
    // rendered twice with different track lists.
    expect(sections[3]).toMatchObject({ tracks: [{ id: 'download' }] });
    expect(sections.some((section) => section.title === 'Trending songs')).toBe(false);
  });

  it('falls back to global mixes and charts when personalization is empty', () => {
    const sections = composeHomeSections(
      [],
      [recent(['local-recent']), tracks('Saved for you', ['download'])],
      [mixes('global'), tracks('Trending songs', ['chart'])]
    );

    expect(sections.map((section) => section.title)).toEqual([
      'Made for you',
      'Recently played',
      'Saved for you',
      'Trending songs',
    ]);
    expect(sections[0]).toMatchObject({ mixes: [{ id: 'global' }] });
  });

  it('dedupes tracks across the local and personalized rails', () => {
    const sections = composeHomeSections(
      [mixes('personal'), tracks('Because you listen to', ['shared', 'other'])],
      [tracks('Saved for you', ['shared'])],
      []
    );

    const saved = sections.find(
      (section) => section.kind === 'tracks' && section.title === 'Saved for you'
    );
    const because = sections.find(
      (section) => section.kind === 'tracks' && section.title === 'Because you listen to'
    );
    expect(saved).toMatchObject({ tracks: [{ id: 'shared' }] });
    expect(because).toMatchObject({ tracks: [{ id: 'other' }] });
  });

  it('filters stale recommendation data with current hide and thumbs-down feedback', () => {
    const feedbackMix: DailyMix = {
      ...mix('feedback'),
      tracks: [track('mix-hide'), track('mix-keep')],
      trackCount: 2,
    };
    const sections: HomeSection[] = [
      { kind: 'mixes', title: 'Made for you', mixes: [feedbackMix] },
      tracks('Fresh finds', ['rail-hide', 'thumbed', 'rail-keep']),
      tracks('All hidden', ['rail-hide']),
      {
        kind: 'albums',
        title: 'From artists',
        albums: [album('hidden-album', 'Hidden Artist'), album('other-album', 'Other Artist')],
      },
      {
        kind: 'artists',
        title: 'Trending artists',
        artists: [artist('Hidden Artist'), artist('Other Artist')],
      },
    ];

    const filtered = filterFeedbackSections(
      sections,
      new Set(['mix-hide', 'rail-hide', 'thumbed']),
      ['Hidden Artist']
    );

    expect(filtered.find((section) => section.kind === 'mixes')).toMatchObject({
      mixes: [{ id: 'feedback', trackCount: 1, tracks: [{ id: 'mix-keep' }] }],
    });
    expect(
      filtered.find((section) => section.kind === 'tracks' && section.title === 'Fresh finds')
    ).toMatchObject({ tracks: [{ id: 'rail-keep' }] });
    expect(
      filtered.find((section) => section.kind === 'tracks' && section.title === 'All hidden')
    ).toBeUndefined();
    expect(filtered.find((section) => section.kind === 'albums')).toMatchObject({
      albums: [{ id: 'other-album' }],
    });
    expect(filtered.find((section) => section.kind === 'artists')).toMatchObject({
      artists: [{ name: 'Other Artist' }],
    });
  });
});
