import { describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';
import { PersonalizationService, type DailyMix, type LibraryPayload } from './personalization.js';

function track(id: string, artist = 'Fresh Artist', title = `Track ${id}`): CanonicalTrack {
  return {
    id,
    title,
    artists: [{ id: `artist:${artist}`, name: artist, providerIds: {}, genres: [] }],
    durationMs: 1000,
    artworkUrl: undefined,
    providerIds: {},
    explicit: false,
  };
}

function historyRow(trackId: string, trackArtist: string | null, daysAgo = 0) {
  return {
    trackId,
    trackTitle: `Title ${trackId}`,
    trackArtist,
    trackAlbum: null,
    trackArtwork: null,
    durationMs: 1000,
    playedAt: new Date(Date.now() - daysAgo * 24 * 3600 * 1000),
  };
}

function favoriteRow(
  targetType: string,
  targetId: string,
  targetTitle: string | null,
  targetSubtitle: string | null
) {
  return { targetType, targetId, targetTitle, targetSubtitle };
}

function makeDb(history: unknown[], favorites: unknown[]) {
  return {
    history: { findMany: vi.fn().mockResolvedValue(history) },
    favorite: { findMany: vi.fn().mockResolvedValue(favorites) },
  };
}

/** iTunes adapter fake: artist name -> primary genre name; albums via search. */
function makeItunes(genres: Record<string, string | null> = {}) {
  return {
    searchArtists: vi.fn(async (name: string, _limit: number) =>
      genres[name] ? [{ genres: [genres[name]] }] : []
    ),
    searchAlbums: vi.fn(async (name: string, limit: number) =>
      Array.from({ length: limit }, (_, i) => ({
        id: `album:${name}:${i}`,
        title: `${name} Album ${i}`,
        artist: { id: `artist:${name}`, name, providerIds: {}, genres: [] },
        artworkUrl: undefined,
        trackCount: 10,
        providerIds: {},
        type: 'album',
      }))
    ),
    searchTracks: vi.fn(async () => [] as CanonicalTrack[]),
    searchPlaylists: vi.fn(async () => []),
    lookupArtist: vi.fn(async () => null),
    lookupAlbum: vi.fn(async () => null),
  };
}

function makeDeezer(genres: Record<string, number> = {}) {
  return {
    genreForArtist: vi.fn(async (name: string) => genres[name] ?? null),
    genreIdForName: vi.fn(async (name: string) => {
      if (name === 'Hip-Hop/Rap') return 116;
      if (name === 'Rock') return 152;
      if (name === 'Pop') return 132;
      return null;
    }),
    genreName: vi.fn(async (id: number) => `Genre ${id}`),
    genreChartTracks: vi.fn(async (_id: number, _limit: number): Promise<CanonicalTrack[]> => []),
    searchTracks: vi.fn(async (_q: string, _limit: number): Promise<CanonicalTrack[]> => []),
    searchPlaylists: vi.fn(async (_q: string, _limit: number): Promise<unknown[]> => []),
    searchArtists: vi.fn(async (_q: string, _limit: number): Promise<unknown[]> => []),
    genreArtists: vi.fn(async (_id: number, _limit: number): Promise<unknown[]> => []),
    chartTracks: vi.fn(async (): Promise<CanonicalTrack[]> => []),
    chartAlbums: vi.fn(async (): Promise<unknown[]> => []),
    chartArtists: vi.fn(async (): Promise<unknown[]> => []),
    chartPlaylists: vi.fn(async (): Promise<unknown[]> => []),
  };
}

function mixSection(feed: { sections: unknown[] }) {
  return feed.sections.find((s) => (s as { kind: string }).kind === 'mixes') as
    { kind: 'mixes'; mixes: DailyMix[] } | undefined;
}

function trackSection(feed: { sections: unknown[] }, title: string) {
  return feed.sections.find(
    (s) => (s as { kind: string }).kind === 'tracks' && (s as { title: string }).title === title
  ) as
    { kind: 'tracks'; title: string; explanation?: string; tracks: CanonicalTrack[] } | undefined;
}

describe('PersonalizationService', () => {
  it('returns personalized:false with only global sections when there is no signal', async () => {
    const deezer = makeDeezer({});
    deezer.genreChartTracks.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => track(`s${i}`, `Starter ${i}`, `T${i}`))
    );
    const service = new PersonalizationService(makeDb([], []) as never);
    const feed = await service.buildFeed('user-1', makeItunes() as never, deezer as never);
    expect(feed.personalized).toBe(false);
    expect(feed.sections.some((s) => s.kind === 'mixes')).toBe(true);
    expect(feed.sections.some((s) => s.kind === 'recently-played')).toBe(false);
    const mixes = mixSection(feed)!;
    expect(mixes.mixes.length).toBeGreaterThan(0);
    expect(mixes.mixes.every((m) => m.kind === 'mood')).toBe(true);
  });

  it('builds recently played from history in most-recent-first order', async () => {
    const history = [historyRow('t1', 'Artist A'), historyRow('t2', 'Artist B')];
    const service = new PersonalizationService(makeDb(history, []) as never);
    const feed = await service.buildFeed('user-1', makeItunes() as never, makeDeezer() as never);
    expect(feed.personalized).toBe(true);
    const section = feed.sections.find((s) => s.kind === 'recently-played');
    expect(section?.kind === 'recently-played' && section.tracks.map((t) => t.id)).toEqual([
      't1',
      't2',
    ]);
  });

  it('builds one Daily Mix per top genre from the genre chart', async () => {
    const history = [historyRow('t1', 'Pop Artist'), historyRow('t2', 'Rock Artist')];
    const deezer = makeDeezer({});
    deezer.genreChartTracks.mockImplementation(async (id: number) =>
      Array.from({ length: 6 }, (_, i) => track(`${id}-${i}`, `Fresh ${id}-${i}`, `T${i}`))
    );

    const service = new PersonalizationService(makeDb(history, []) as never);
    const mixes = (
      await service.buildMixes(
        'user-1',
        makeItunes({ 'Pop Artist': 'Pop', 'Rock Artist': 'Rock' }) as never,
        deezer as never
      )
    ).filter((m) => m.kind === 'daily');

    expect(mixes.length).toBe(2);
    expect(mixes[0].name).toBe('Daily Mix 1');
    expect(mixes[0].genre).toBe('Genre 132');
    expect(mixes[0].tracks.length).toBeGreaterThanOrEqual(5);
    expect(mixes[0].id).toBe('mix:132');
    expect(mixes[0].description).toContain('Genre 132');
  });

  it('falls back to the Deezer artist genre when iTunes has none', async () => {
    const history = [historyRow('t1', 'Arab Artist')];
    const deezer = makeDeezer({ 'Arab Artist': 196 });
    deezer.genreChartTracks.mockResolvedValue([
      track('g1', 'N1', 'A'),
      track('g2', 'N2', 'B'),
      track('g3', 'N3', 'C'),
      track('g4', 'N4', 'D'),
      track('g5', 'N5', 'E'),
    ]);
    const service = new PersonalizationService(makeDb(history, []) as never);
    const mixes = await service.buildMixes('user-1', makeItunes({}) as never, deezer as never);
    expect(mixes.some((m) => m.id === 'mix:196')).toBe(true);
  });

  it('never re-serves a track the user already heard', async () => {
    const history = [historyRow('heard-1', 'Pop Artist'), historyRow('t2', 'Pop Artist')];
    const deezer = makeDeezer({});
    deezer.genreChartTracks.mockResolvedValue([
      track('heard-1', 'Same Artist', 'Heard'),
      track('pop-1', 'Newcomer', 'Fresh'),
      track('pop-2', 'Newcomer 2', 'Fresh 2'),
      track('pop-3', 'Newcomer 3', 'Fresh 3'),
      track('pop-4', 'Newcomer 4', 'Fresh 4'),
      track('pop-5', 'Newcomer 5', 'Fresh 5'),
    ]);

    const service = new PersonalizationService(makeDb(history, []) as never);
    const mixes = await service.buildMixes(
      'user-1',
      makeItunes({ 'Pop Artist': 'Pop' }) as never,
      deezer as never
    );
    const ids = new Set(mixes.flatMap((m) => m.tracks.map((t) => t.id)));
    expect(ids).not.toContain('heard-1');
  });

  it('prefers artists the user has not listened to before', async () => {
    const history = [historyRow('t1', 'Pop Artist')];
    const deezer = makeDeezer({});
    const known = track('known-1', 'Pop Artist', 'Known Artist');
    const fresh1 = track('fresh-1', 'Newcomer 1', 'Fresh 1');
    const fresh2 = track('fresh-2', 'Newcomer 2', 'Fresh 2');
    const fresh3 = track('fresh-3', 'Newcomer 3', 'Fresh 3');
    const fresh4 = track('fresh-4', 'Newcomer 4', 'Fresh 4');
    const fresh5 = track('fresh-5', 'Newcomer 5', 'Fresh 5');
    deezer.genreChartTracks.mockResolvedValue([known, fresh1, fresh2, fresh3, fresh4, fresh5]);

    const service = new PersonalizationService(makeDb(history, []) as never);
    const mixes = await service.buildMixes(
      'user-1',
      makeItunes({ 'Pop Artist': 'Pop' }) as never,
      deezer as never
    );
    const daily = mixes.find((m) => m.id === 'mix:132')!;
    expect(daily.tracks[0].id).toBe('fresh-1');
    expect(daily.tracks[daily.tracks.length - 1].id).toBe('known-1');
  });

  it('skips weak mixes and still builds the strong ones', async () => {
    const history = [historyRow('t1', 'Pop Artist'), historyRow('t2', 'Rock Artist')];
    const deezer = makeDeezer({});
    deezer.genreChartTracks.mockImplementation(async (id: number) => {
      if (id === 132) return [track('pop-1', 'N1', 'A'), track('pop-2', 'N2', 'B')];
      return Array.from({ length: 6 }, (_, i) => track(`rock-${i}`, `R${i}`, `Rock ${i}`));
    });

    const service = new PersonalizationService(makeDb(history, []) as never);
    const mixes = await service.buildMixes(
      'user-1',
      makeItunes({ 'Pop Artist': 'Pop', 'Rock Artist': 'Rock' }) as never,
      deezer as never
    );
    const dailies = mixes.filter((m) => m.kind === 'daily');
    expect(dailies.length).toBe(1);
    expect(dailies[0].id).toBe('mix:152');
  });

  it('keeps the feed working when providers fail', async () => {
    const history = [historyRow('t1', 'Pop Artist')];
    const failingItunes = {
      searchArtists: vi.fn().mockRejectedValue(new Error('boom')),
      searchAlbums: vi.fn().mockRejectedValue(new Error('boom')),
      searchTracks: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const failingDeezer = {
      genreForArtist: vi.fn().mockRejectedValue(new Error('boom')),
      genreIdForName: vi.fn().mockRejectedValue(new Error('boom')),
      genreName: vi.fn().mockRejectedValue(new Error('boom')),
      genreChartTracks: vi.fn().mockRejectedValue(new Error('boom')),
      searchTracks: vi.fn().mockRejectedValue(new Error('boom')),
      searchPlaylists: vi.fn().mockRejectedValue(new Error('boom')),
      searchArtists: vi.fn().mockRejectedValue(new Error('boom')),
      genreArtists: vi.fn().mockRejectedValue(new Error('boom')),
      chartTracks: vi.fn().mockRejectedValue(new Error('boom')),
      chartAlbums: vi.fn().mockRejectedValue(new Error('boom')),
      chartArtists: vi.fn().mockRejectedValue(new Error('boom')),
      chartPlaylists: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const service = new PersonalizationService(makeDb(history, []) as never);
    const feed = await service.buildFeed('user-1', failingItunes as never, failingDeezer as never);
    expect(feed.personalized).toBe(true);
    expect(feed.sections.some((s) => s.kind === 'recently-played')).toBe(true);
    expect(feed.sections.some((s) => s.kind === 'mixes')).toBe(false);
  });

  it('includes favorited artists in the genre affinity pool', async () => {
    const favorites = [favoriteRow('artist', 'itunes:1', 'Fav Artist', null)];
    const deezer = makeDeezer({});
    deezer.genreChartTracks.mockResolvedValue([
      track('g1', 'N1', 'A'),
      track('g2', 'N2', 'B'),
      track('g3', 'N3', 'C'),
      track('g4', 'N4', 'D'),
      track('g5', 'N5', 'E'),
    ]);
    const service = new PersonalizationService(makeDb([], favorites) as never);
    const mixes = await service.buildMixes(
      'user-1',
      makeItunes({ 'Fav Artist': 'Hip-Hop/Rap' }) as never,
      deezer as never
    );
    expect(mixes.some((m) => m.id === 'mix:116')).toBe(true);
  });

  it('hides the Favorites Mix when the user has no favorite tracks', async () => {
    const history = [historyRow('t1', 'Pop Artist')];
    const deezer = makeDeezer({});
    deezer.genreChartTracks.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => track(`g${i}`, `N${i}`, `A${i}`))
    );
    const service = new PersonalizationService(makeDb(history, []) as never);
    const mixes = await service.buildMixes(
      'user-1',
      makeItunes({ 'Pop Artist': 'Pop' }) as never,
      deezer as never
    );
    expect(mixes.some((m) => m.kind === 'favorites')).toBe(false);
  });

  it('builds a Favorites Mix from favorite tracks when they exist', async () => {
    const favorites = [
      favoriteRow('track', 'fav-1', 'Fav One', 'Pop Artist'),
      favoriteRow('track', 'fav-2', 'Fav Two', 'Pop Artist'),
      favoriteRow('track', 'fav-3', 'Fav Three', 'Pop Artist'),
    ];
    const deezer = makeDeezer({ 'Pop Artist': 132 });
    deezer.genreChartTracks.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => track(`g${i}`, `N${i}`, `A${i}`))
    );
    const service = new PersonalizationService(makeDb([], favorites) as never);
    const mixes = await service.buildMixes(
      'user-1',
      makeItunes({ 'Pop Artist': 'Pop' }) as never,
      deezer as never
    );
    const fav = mixes.find((m) => m.kind === 'favorites')!;
    expect(fav).toBeDefined();
    expect(fav.tracks.map((t) => t.id).slice(0, 3)).toEqual(['fav-1', 'fav-2', 'fav-3']);
  });

  it('builds a Discovery Mix with only unknown artists, from genres beyond the Daily Mixes', async () => {
    // Six artists -> six distinct genres: the top 4 feed Daily Mixes, the
    // next 2 feed the Discovery Mix.
    const history = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((name, i) =>
      historyRow(`t${i + 1}`, name)
    );
    const deezer = makeDeezer({ A1: 101, A2: 102, A3: 103, A4: 104, A5: 105, A6: 106 });
    deezer.genreChartTracks.mockImplementation(async (id: number) =>
      Array.from({ length: 8 }, (_, i) => track(`g${id}-${i}`, `D${id}-${i}`, `T${i}`))
    );
    const service = new PersonalizationService(makeDb(history, []) as never);
    const mixes = await service.buildMixes('user-1', makeItunes() as never, deezer as never);
    const discovery = mixes.find((m) => m.kind === 'discovery')!;
    expect(discovery).toBeDefined();
    expect(
      discovery.tracks.every(
        (t) => !['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].includes(t.artists[0]?.name ?? '')
      )
    ).toBe(true);
  });

  it('builds an Artist Mix with own songs capped so no single artist dominates', async () => {
    const history = [historyRow('t1', 'Headliner')];
    const deezer = makeDeezer({ Headliner: 132 });
    deezer.searchTracks.mockImplementation(async (q: string) => {
      if (q.includes('Headliner')) {
        return Array.from({ length: 15 }, (_, i) => track(`own-${i}`, 'Headliner', `Own ${i}`));
      }
      return [];
    });
    deezer.genreChartTracks.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => track(`g${i}`, `Other ${i}`, `A${i}`))
    );
    const service = new PersonalizationService(makeDb(history, []) as never);
    const mixes = await service.buildMixes(
      'user-1',
      makeItunes({ Headliner: 'Pop' }) as never,
      deezer as never
    );
    const artist = mixes.find((m) => m.kind === 'artist' && m.name === 'Headliner Mix')!;
    expect(artist).toBeDefined();
    const ownCount = artist.tracks.filter((t) => t.artists[0]?.name === 'Headliner').length;
    expect(ownCount).toBeLessThanOrEqual(8);
    expect(artist.tracks.some((t) => t.artists[0]?.name !== 'Headliner')).toBe(true);
  });

  it('refreshes mixes gradually: keeps ~60% of the previous tracks', async () => {
    const history = [historyRow('t1', 'Pop Artist')];
    const deezer = makeDeezer({});
    const pool = Array.from({ length: 40 }, (_, i) =>
      track(`pool-${i}`, `Artist ${i % 8}`, `T${i}`)
    );
    deezer.genreChartTracks.mockResolvedValue(pool);
    const itunes = makeItunes({ 'Pop Artist': 'Pop' });
    const service = new PersonalizationService(makeDb(history, []) as never);

    const first = await service.buildMixes('user-1', itunes as never, deezer as never);
    const second = await service.buildMixes('user-1', itunes as never, deezer as never, {
      previous: first.filter((m) => m.kind === 'daily'),
    });
    const firstDaily = first.find((m) => m.id === 'mix:132')!;
    const secondDaily = second.find((m) => m.id === 'mix:132')!;
    const firstIds = new Set(firstDaily.tracks.map((t) => t.id));
    const kept = secondDaily.tracks.filter((t) => firstIds.has(t.id)).length;
    expect(kept).toBeGreaterThanOrEqual(Math.floor(30 * 0.6) - 1);
    expect(secondDaily.id).toBe(firstDaily.id);
    expect(secondDaily.name).toBe(firstDaily.name);
  });

  it('never repeats a track across mix and recommendation sections', async () => {
    const history = [historyRow('t1', 'Pop Artist')];
    const deezer = makeDeezer({});
    const pool = Array.from({ length: 40 }, (_, i) =>
      track(`pool-${i}`, `Artist ${i % 8}`, `T${i}`)
    );
    deezer.genreChartTracks.mockResolvedValue(pool);
    const service = new PersonalizationService(makeDb(history, []) as never);
    const feed = await service.buildFeed(
      'user-1',
      makeItunes({ 'Pop Artist': 'Pop' }) as never,
      deezer as never
    );

    const allTrackIds: string[] = [];
    for (const section of feed.sections) {
      if (section.kind === 'mixes') {
        for (const mix of section.mixes) allTrackIds.push(...mix.tracks.map((t) => t.id));
      } else if (section.kind === 'tracks') {
        allTrackIds.push(...section.tracks.map((t) => t.id));
      }
    }
    const unique = new Set(allTrackIds);
    expect(unique.size).toBe(allTrackIds.length);
  });

  it('adds a quick access section from the library playlists payload', async () => {
    const library: LibraryPayload = {
      playlists: [
        { id: 'playlist-1', name: 'Gym', trackCount: 12, updatedAt: 1000 },
        { id: 'playlist-2', name: 'Focus', trackCount: 8, updatedAt: 2000 },
      ],
      recentlyPlayedPlaylistIds: ['playlist-2'],
    };
    const service = new PersonalizationService(makeDb([], []) as never);
    const feed = await service.buildFeed('user-1', makeItunes() as never, makeDeezer() as never, {
      library,
    });
    const quick = feed.sections.find((s) => s.kind === 'quick-access');
    expect(quick?.kind === 'quick-access').toBe(true);
    if (quick?.kind === 'quick-access') {
      expect(quick.playlists.map((p) => p.id)).toEqual(['playlist-2', 'playlist-1']);
      expect(quick.playlists[0].owner.name).toBe('You');
    }
  });

  it('adds a recently added section from downloaded tracks', async () => {
    const library: LibraryPayload = {
      downloadedTracks: [
        track('dl-1', 'DL Artist', 'Offline One'),
        track('dl-2', 'DL Artist', 'Offline Two'),
      ],
    };
    const service = new PersonalizationService(makeDb([], []) as never);
    const feed = await service.buildFeed('user-1', makeItunes() as never, makeDeezer() as never, {
      library,
    });
    const section = feed.sections.find(
      (s) => s.kind === 'tracks' && s.title === 'Recently added'
    ) as { kind: 'tracks'; tracks: CanonicalTrack[] };
    expect(section).toBeDefined();
    expect(section.tracks.map((t) => t.id)).toEqual(['dl-1', 'dl-2']);
  });

  it('recommendations carry short explanations', async () => {
    const history = [historyRow('t1', 'Pop Artist')];
    const deezer = makeDeezer({ 'Pop Artist': 132 });
    deezer.genreChartTracks.mockResolvedValue(
      Array.from({ length: 60 }, (_, i) => track(`g${i}`, `N${i}`, `A${i}`))
    );
    deezer.searchPlaylists.mockResolvedValue([
      {
        id: 'p1',
        name: 'Pop Hits',
        owner: { id: 'x', name: 'Deezer' },
        isCollaborative: false,
        trackCount: 50,
        providerIds: {},
        createdAt: '',
        updatedAt: '',
        artworkUrl: undefined,
        description: undefined,
      },
    ]);
    const service = new PersonalizationService(makeDb(history, []) as never);
    const feed = await service.buildFeed(
      'user-1',
      makeItunes({ 'Pop Artist': 'Pop' }) as never,
      deezer as never
    );

    const songs = trackSection(feed, 'Recommended songs');
    expect(songs?.explanation).toBe('Because you listen to Pop Artist');
    const playlists = feed.sections.find(
      (s) => s.kind === 'playlists' && s.title === 'Recommended playlists'
    );
    expect(playlists?.kind === 'playlists' && playlists.explanation).toBe(
      'Based on your listening'
    );
    const albums = feed.sections.find(
      (s) => s.kind === 'albums' && s.title === 'Albums you might like'
    );
    expect(albums?.kind === 'albums' && albums.explanation).toContain('Pop Artist');
  });

  it('prioritizes recent listening over old listening', async () => {
    const history = [historyRow('old-1', 'Old Artist', 60), historyRow('new-1', 'New Artist', 1)];
    const service = new PersonalizationService(makeDb(history, []) as never);
    const feed = await service.buildFeed(
      'user-1',
      makeItunes({ 'Old Artist': 'Pop', 'New Artist': 'Rock' }) as never,
      makeDeezer() as never
    );
    const albums = feed.sections.find(
      (s) => s.kind === 'albums' && s.title === 'Albums you might like'
    );
    expect(albums?.kind === 'albums' && albums.explanation).toContain('New Artist');
  });
});
