/**
 * Realistic MusicBrainz ws/2 JSON fixtures (shapes as returned by the API).
 * Used by the mocked-HTTP provider tests and the search/dedup unit tests.
 */

export const mbRecordingSearch = {
  created: '2026-08-13T00:00:00.000Z',
  count: 1,
  recordings: [
    {
      id: 'rec-0000-0000-0000-000000000001',
      title: 'Hotel California (Remix)',
      score: 100,
      length: 391000,
      'artist-credit': [
        {
          name: 'Eagles',
          artist: {
            id: 'art-0000-0000-0000-000000000001',
            name: 'Eagles',
            type: 'Group',
            'sort-name': 'Eagles',
          },
        },
      ],
      'first-release-date': '1976-12-08',
      isrcs: ['USMC17638786'],
      releases: [
        {
          id: 'rel-0000-0000-0000-000000000001',
          title: 'Hotel California',
          date: '1976-12-08',
          'release-group': {
            id: 'rg-0000-0000-0000-000000000001',
            title: 'Hotel California',
            'primary-type': 'Album',
          },
        },
      ],
    },
  ],
};

export const mbArtistSearch = {
  count: 2,
  artists: [
    {
      id: 'art-0000-0000-0000-000000000001',
      name: 'Eagles',
      score: 100,
      type: 'Group',
      disambiguation: 'American rock band',
      'sort-name': 'Eagles',
      area: { name: 'United States' },
      'life-span': { begin: '1971', ended: false },
      tags: [{ name: 'rock' }, { name: 'classic rock' }],
    },
    {
      id: 'art-0000-0000-0000-000000000002',
      name: 'The Eagles',
      score: 30,
      type: 'Person',
      disambiguation: 'folk singer',
      'sort-name': 'Eagles, The',
      tags: [],
    },
  ],
};

export const mbAlbumSearch = {
  count: 1,
  'release-groups': [
    {
      id: 'rg-0000-0000-0000-000000000001',
      title: 'Hotel California',
      'primary-type': 'Album',
      'first-release-date': '1976-12-08',
      'artist-credit': [
        {
          name: 'Eagles',
          artist: { id: 'art-0000-0000-0000-000000000001', name: 'Eagles' },
        },
      ],
      'release-list': [
        {
          id: 'rel-0000-0000-0000-000000000001',
          title: 'Hotel California',
          date: '1976-12-08',
          status: 'Official',
          media: [{ format: 'Vinyl', 'track-count': 9 }],
        },
      ],
    },
  ],
};

export const mbArtistLookup = {
  id: 'art-0000-0000-0000-000000000001',
  name: 'Eagles',
  type: 'Group',
  disambiguation: 'American rock band',
  'sort-name': 'Eagles',
  area: { name: 'United States' },
  'life-span': { begin: '1971', end: '2016', ended: true },
  tags: [{ name: 'rock' }],
  genres: [{ name: 'classic rock' }],
};

export const mbRecordingLookup = {
  id: 'rec-0000-0000-0000-000000000001',
  title: 'Hotel California',
  length: 391000,
  'artist-credit': [
    {
      name: 'Eagles',
      artist: { id: 'art-0000-0000-0000-000000000001', name: 'Eagles' },
    },
  ],
  'first-release-date': '1976-12-08',
  isrcs: ['USMC17638786'],
  releases: [
    {
      id: 'rel-0000-0000-0000-000000000001',
      title: 'Hotel California',
      date: '1976-12-08',
      'release-group': {
        id: 'rg-0000-0000-0000-000000000001',
        title: 'Hotel California',
        'primary-type': 'Album',
      },
    },
  ],
};

export const mbReleaseGroupLookup = {
  id: 'rg-0000-0000-0000-000000000001',
  title: 'Hotel California',
  'primary-type': 'Album',
  'secondary-types': [],
  'first-release-date': '1976-12-08',
  'artist-credit': [
    {
      name: 'Eagles',
      artist: { id: 'art-0000-0000-0000-000000000001', name: 'Eagles' },
    },
  ],
  'release-list': [
    {
      id: 'rel-0000-0000-0000-000000000001',
      title: 'Hotel California',
      date: '1976-12-08',
      status: 'Official',
      media: [
        {
          position: 1,
          format: 'Vinyl',
          'track-count': 2,
          track: [
            {
              number: 'A1',
              position: 1,
              title: 'Hotel California',
              length: 391000,
              recording: { id: 'rec-1', title: 'Hotel California', isrcs: ['USMC17638786'] },
            },
            {
              number: 'A2',
              position: 2,
              title: 'New Kid in Town',
              length: 318000,
              recording: { id: 'rec-2', title: 'New Kid in Town', isrcs: ['USMC17638787'] },
            },
          ],
        },
      ],
    },
  ],
};

export const mbArtistRecordings = {
  count: 2,
  recordings: [
    {
      id: 'rec-0000-0000-0000-000000000001',
      title: 'Hotel California',
      length: 391000,
      'artist-credit': [
        {
          name: 'Eagles',
          artist: { id: 'art-0000-0000-0000-000000000001', name: 'Eagles' },
        },
      ],
      isrcs: ['USMC17638786'],
    },
    {
      id: 'rec-0000-0000-0000-000000000002',
      title: 'New Kid in Town',
      length: 318000,
      'artist-credit': [
        {
          name: 'Eagles',
          artist: { id: 'art-0000-0000-0000-000000000001', name: 'Eagles' },
        },
      ],
      isrcs: ['USMC17638787'],
    },
  ],
};

export const mbArtistReleaseGroups = {
  count: 1,
  'release-groups': [
    {
      id: 'rg-0000-0000-0000-000000000001',
      title: 'Hotel California',
      'primary-type': 'Album',
      'first-release-date': '1976-12-08',
      'artist-credit': [
        {
          name: 'Eagles',
          artist: { id: 'art-0000-0000-0000-000000000001', name: 'Eagles' },
        },
      ],
    },
  ],
};

export const mbRelatedArtists = {
  id: 'art-0000-0000-0000-000000000001',
  name: 'Eagles',
  relations: [
    {
      type: 'artist',
      direction: 'forward',
      target: 'art-0000-0000-0000-000000000003',
      artist: {
        id: 'art-0000-0000-0000-000000000003',
        name: 'The Doobie Brothers',
        type: 'Group',
        'sort-name': 'Doobie Brothers, The',
      },
    },
    {
      type: 'recording',
      target: 'rec-xyz',
    },
  ],
};

export const mbReleaseLookup = {
  id: 'rel-0000-0000-0000-000000000001',
  title: 'Hotel California',
  date: '1976-12-08',
  status: 'Official',
  'artist-credit': [
    {
      name: 'Eagles',
      artist: { id: 'art-0000-0000-0000-000000000001', name: 'Eagles' },
    },
  ],
  media: [
    {
      position: 1,
      format: 'Vinyl',
      'track-count': 2,
      track: [
        {
          number: 'A1',
          position: 1,
          title: 'Hotel California',
          length: 391000,
          recording: { id: 'rec-1', title: 'Hotel California', isrcs: ['USMC17638786'] },
        },
        {
          number: 'A2',
          position: 2,
          title: 'New Kid in Town',
          length: 318000,
          recording: { id: 'rec-2', title: 'New Kid in Town', isrcs: ['USMC17638787'] },
        },
      ],
    },
  ],
};
