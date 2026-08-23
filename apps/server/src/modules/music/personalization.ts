/**
 * M6 Personalization — Home feed. The user's listening signal (history +
 * favorites + downloads + follows + playlists) is summarized into a
 * recency-weighted profile and expanded into an ordered list of typed Home
 * sections: quick access, "made for you" mixes, recommendations, discovery,
 * new releases and trending.
 *
 * Design rules implemented here:
 * - Sections are only emitted when their data exists (no empty rails).
 * - Mixes keep stable identities (`mix:<genreId>`, `mix:artist:<name>`, ...)
 *   and regenerate gradually: a refresh keeps ~60% of the previous tracks.
 * - Ids are deduped across the whole feed, and artists are interleaved so no
 *   single artist dominates a rail.
 * - Recency weighting: a play from 14 days ago counts half as much as today.
 * - The internal scoring (plays + favorites + downloads) is never exposed.
 */
import type { PrismaClient } from '@prisma/client';
import type {
  CanonicalAlbum,
  CanonicalArtist,
  CanonicalPlaylist,
  CanonicalTrack,
} from '@sinc/shared';
import { prisma as defaultPrisma } from '../../lib/prisma.js';
import type { DeezerAdapter } from '../../lib/deezer.js';
import type { ItunesAdapter } from '../../lib/itunes.js';

const HISTORY_LIMIT = 60;
const FAVORITES_LIMIT = 50;
const MAX_ARTISTS = 8;
const MAX_DAILY_MIXES = 4;
const MAX_ARTIST_MIXES = 2;
const MIX_SIZE = 30;
const MIN_MIX_SIZE = 5;
const MAX_SECTIONS = 10;
/** Recency half-life: a play 14 days ago counts half as much as one today. */
const RECENCY_HALF_LIFE_MS = 14 * 24 * 3600 * 1000;
/** Share of a mix's tracks kept when the mix regenerates (gradual refresh). */
const MIX_REFRESH_KEEP = 0.6;

export type MixKind = 'daily' | 'favorites' | 'discovery' | 'artist' | 'mood';

export interface DailyMix {
  id: string;
  name: string;
  kind: MixKind;
  genre: string;
  description?: string;
  artworkUrl?: string;
  trackCount: number;
  tracks: CanonicalTrack[];
}

export type HomeSection =
  | { kind: 'quick-access'; title: string; playlists: CanonicalPlaylist[] }
  | { kind: 'recently-played'; title: string; tracks: CanonicalTrack[] }
  | { kind: 'mixes'; title: string; mixes: DailyMix[] }
  | { kind: 'tracks'; title: string; explanation?: string; tracks: CanonicalTrack[] }
  | { kind: 'albums'; title: string; explanation?: string; albums: CanonicalAlbum[] }
  | { kind: 'artists'; title: string; explanation?: string; artists: CanonicalArtist[] }
  | { kind: 'playlists'; title: string; explanation?: string; playlists: CanonicalPlaylist[] };

export interface HomeFeedResponse {
  sections: HomeSection[];
  personalized: boolean;
}

/** Library summary sent by the mobile app (local playlists, downloads, follows). */
export interface LibraryPayload {
  playlists?: Array<{
    id: string;
    name: string;
    artworkUrl?: string;
    trackCount: number;
    updatedAt: number;
  }>;
  recentlyPlayedPlaylistIds?: string[];
  downloadedTracks?: CanonicalTrack[];
  followedArtists?: CanonicalArtist[];
  followedAlbums?: CanonicalAlbum[];
}

/** Sanitizes the raw request body into a LibraryPayload (never throws). */
export function parseLibraryPayload(raw: unknown): LibraryPayload {
  const body = (raw ?? {}) as Record<string, unknown>;
  const playlists = Array.isArray(body.playlists)
    ? body.playlists
        .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
        .map((p) => ({
          id: typeof p.id === 'string' ? p.id : '',
          name: typeof p.name === 'string' ? p.name : 'Playlist',
          artworkUrl: typeof p.artworkUrl === 'string' ? p.artworkUrl : undefined,
          trackCount: typeof p.trackCount === 'number' ? p.trackCount : 0,
          updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : 0,
        }))
        .filter((p) => p.id.length > 0)
    : [];
  const recentlyPlayedPlaylistIds = Array.isArray(body.recentlyPlayedPlaylistIds)
    ? body.recentlyPlayedPlaylistIds.filter((x): x is string => typeof x === 'string')
    : [];
  const downloadedTracks = Array.isArray(body.downloadedTracks)
    ? body.downloadedTracks.filter(
        (t): t is CanonicalTrack =>
          typeof t === 'object' && t !== null && typeof (t as { id?: unknown }).id === 'string'
      )
    : [];
  const followedArtists = Array.isArray(body.followedArtists)
    ? body.followedArtists.filter(
        (a): a is CanonicalArtist =>
          typeof a === 'object' && a !== null && typeof (a as { name?: unknown }).name === 'string'
      )
    : [];
  const followedAlbums = Array.isArray(body.followedAlbums)
    ? body.followedAlbums.filter(
        (a): a is CanonicalAlbum =>
          typeof a === 'object' && a !== null && typeof (a as { id?: unknown }).id === 'string'
      )
    : [];
  return {
    playlists,
    recentlyPlayedPlaylistIds,
    downloadedTracks,
    followedArtists,
    followedAlbums,
  };
}

interface HistoryRow {
  trackId: string;
  trackTitle: string | null;
  trackArtist: string | null;
  trackAlbum: string | null;
  trackArtwork: string | null;
  durationMs: number | null;
  playedAt: Date;
}

interface FavoriteRow {
  targetType: string;
  targetId: string;
  targetTitle: string | null;
  targetSubtitle: string | null;
}

type PersonalizationDb = Pick<PrismaClient, 'history' | 'favorite'>;

interface Signal {
  /** Deduped history tracks (most recent first) then unheard favorite tracks. */
  familiar: CanonicalTrack[];
  heardIds: Set<string>;
  favoriteTrackIds: Set<string>;
  downloadedTrackIds: Set<string>;
  /** trackId -> recency-weighted play score. */
  playWeights: Map<string, number>;
  /** artistName -> interest score (plays + favorites + downloads + follows). */
  artists: Map<string, number>;
  favoriteArtists: Set<string>;
  downloadedArtists: Set<string>;
  followedArtists: Set<string>;
  /** Most recent first. */
  downloadedTracks: CanonicalTrack[];
  playlists: NonNullable<LibraryPayload['playlists']>;
  recentlyPlayedPlaylistIds: string[];
}

function trackFromHistory(row: HistoryRow): CanonicalTrack | null {
  if (!row.trackTitle) return null;
  const artistName = row.trackArtist ?? 'Unknown';
  const artist = { id: `history:${artistName}`, name: artistName, providerIds: {}, genres: [] };
  return {
    id: row.trackId,
    title: row.trackTitle,
    artists: [artist],
    album: row.trackAlbum
      ? {
          id: `history-album:${row.trackAlbum}`,
          title: row.trackAlbum,
          artist,
          artworkUrl: undefined,
          providerIds: {},
          trackCount: 0,
          type: 'album',
        }
      : undefined,
    durationMs: row.durationMs ?? 0,
    artworkUrl: row.trackArtwork ?? undefined,
    providerIds: {},
    explicit: false,
  };
}

function trackFromFavorite(fav: FavoriteRow): CanonicalTrack {
  const artistName = fav.targetSubtitle ?? 'Unknown';
  return {
    id: fav.targetId,
    title: fav.targetTitle ?? 'Track',
    artists: [{ id: `favorite:${artistName}`, name: artistName, providerIds: {}, genres: [] }],
    durationMs: 0,
    artworkUrl: undefined,
    providerIds: {},
    explicit: false,
  };
}

function playlistFromLibrary(
  p: NonNullable<LibraryPayload['playlists']>[number]
): CanonicalPlaylist {
  return {
    id: p.id,
    name: p.name,
    artworkUrl: p.artworkUrl,
    owner: { id: 'local', name: 'You' },
    isCollaborative: false,
    trackCount: p.trackCount,
    providerIds: {},
    createdAt: new Date(p.updatedAt).toISOString(),
    updatedAt: new Date(p.updatedAt).toISOString(),
  };
}

function recencyWeight(playedAt: Date, now: number): number {
  return Math.pow(0.5, (now - playedAt.getTime()) / RECENCY_HALF_LIFE_MS);
}

function bump(artists: Map<string, number>, name: string, amount: number): void {
  artists.set(name, (artists.get(name) ?? 0) + amount);
}

/** Round-robins tracks by artist so one artist never dominates a rail. */
function interleaveByArtist(tracks: CanonicalTrack[], limit: number): CanonicalTrack[] {
  const buckets = new Map<string, CanonicalTrack[]>();
  for (const t of tracks) {
    const key = t.artists[0]?.name ?? t.id;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(t);
    else buckets.set(key, [t]);
  }
  const keys = [...buckets.keys()];
  const out: CanonicalTrack[] = [];
  let round = 0;
  while (out.length < limit && keys.length > 0) {
    let added = 0;
    for (const key of keys) {
      const bucket = buckets.get(key)!;
      if (round < bucket.length) {
        out.push(bucket[round]);
        added += 1;
      }
    }
    if (added === 0) break;
    round += 1;
  }
  return out;
}

/**
 * Picks mix tracks from candidates: never serves an excluded id, prefers
 * artists outside the user's known set, and interleaves by artist. Known
 * artists' tracks sink to the back instead of being dropped.
 */
function selectMixTracks(
  candidates: CanonicalTrack[],
  knownArtists: Set<string>,
  exclude: Set<string>,
  size: number
): CanonicalTrack[] {
  const fresh: CanonicalTrack[] = [];
  const known: CanonicalTrack[] = [];
  const seen = new Set<string>();
  for (const track of candidates) {
    if (exclude.has(track.id) || seen.has(track.id)) continue;
    seen.add(track.id);
    const artist = track.artists[0]?.name ?? '';
    (knownArtists.has(artist) ? known : fresh).push(track);
  }
  const merged = [...interleaveByArtist(fresh, size), ...interleaveByArtist(known, size)];
  return merged.slice(0, size);
}

/** Keeps ~keepRatio of the previous mix's tracks (gradual refresh). */
function applyGradualRefresh(
  newTracks: CanonicalTrack[],
  previous: CanonicalTrack[] | undefined,
  keepRatio: number
): CanonicalTrack[] {
  if (!previous || previous.length === 0) return newTracks;
  const prevIds = new Set(previous.map((t) => t.id));
  const keepCount = Math.min(newTracks.length, Math.max(1, Math.floor(MIX_SIZE * keepRatio)));
  const keep = newTracks.filter((t) => prevIds.has(t.id)).slice(0, keepCount);
  const rest = newTracks.filter((t) => !prevIds.has(t.id));
  return [...keep, ...rest].slice(0, MIX_SIZE);
}

export class PersonalizationService {
  /** Short-lived memo of genre affinity per user: buildMixes and buildHomeFeed
   *  both need it, and it costs one external lookup per top artist. */
  private affinityMemo = new Map<string, { value: Map<number, number>; expiresAt: number }>();
  private static AFFINITY_TTL_MS = 5 * 60 * 1000;

  constructor(private readonly db: PersonalizationDb = defaultPrisma) {}

  /** Reads + dedupes the user's listening signal in one DB pass. */
  private async loadSignal(userId: string, library: LibraryPayload = {}): Promise<Signal> {
    const [history, favorites] = await Promise.all([
      this.db.history.findMany({
        where: { userId },
        orderBy: { playedAt: 'desc' },
        take: HISTORY_LIMIT,
      }),
      this.db.favorite.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: FAVORITES_LIMIT,
      }),
    ]);

    const now = Date.now();
    const familiar: CanonicalTrack[] = [];
    const heardIds = new Set<string>();
    const favoriteTrackIds = new Set<string>();
    const downloadedTrackIds = new Set<string>();
    const playWeights = new Map<string, number>();
    const artists = new Map<string, number>();
    const favoriteArtists = new Set<string>();
    const downloadedArtists = new Set<string>();
    const followedArtists = new Set<string>();
    const downloadedTracks = library.downloadedTracks ?? [];

    for (const row of history) {
      const track = trackFromHistory(row);
      if (track) {
        const weight = recencyWeight(row.playedAt, now);
        playWeights.set(track.id, Math.max(playWeights.get(track.id) ?? 0, weight));
        if (!heardIds.has(track.id)) {
          heardIds.add(track.id);
          familiar.push(track);
        }
      }
      if (row.trackArtist) bump(artists, row.trackArtist, recencyWeight(row.playedAt, now));
    }
    for (const fav of favorites) {
      if (fav.targetType === 'track') {
        favoriteTrackIds.add(fav.targetId);
        if (!heardIds.has(fav.targetId)) {
          heardIds.add(fav.targetId);
          familiar.push(trackFromFavorite(fav));
        }
        if (fav.targetSubtitle) bump(artists, fav.targetSubtitle, 3);
      }
      if (fav.targetType === 'artist' && fav.targetTitle) {
        favoriteArtists.add(fav.targetTitle);
        bump(artists, fav.targetTitle, 3);
      }
    }
    for (const track of downloadedTracks) {
      downloadedTrackIds.add(track.id);
      const name = track.artists[0]?.name;
      if (name) {
        downloadedArtists.add(name);
        bump(artists, name, 2);
      }
    }
    for (const artist of library.followedArtists ?? []) {
      followedArtists.add(artist.name);
      bump(artists, artist.name, 3);
    }

    return {
      familiar,
      heardIds,
      favoriteTrackIds,
      downloadedTrackIds,
      playWeights,
      artists,
      favoriteArtists,
      downloadedArtists,
      followedArtists,
      downloadedTracks,
      playlists: library.playlists ?? [],
      recentlyPlayedPlaylistIds: library.recentlyPlayedPlaylistIds ?? [],
    };
  }

  /** Freshly played tracks (most recent first), deduped. */
  async buildRecentlyPlayed(userId: string): Promise<CanonicalTrack[]> {
    const signal = await this.loadSignal(userId);
    return signal.familiar.slice(0, 10);
  }

  /** Memoized per user; both buildMixes and buildHomeFeed need it. */
  private async genreAffinityFor(
    userId: string,
    signal: Signal,
    itunes: ItunesAdapter,
    deezer: DeezerAdapter
  ): Promise<Map<number, number>> {
    const cached = this.affinityMemo.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.genreAffinity(signal, itunes, deezer);
    this.affinityMemo.set(userId, {
      value,
      expiresAt: Date.now() + PersonalizationService.AFFINITY_TTL_MS,
    });
    if (this.affinityMemo.size > 512) {
      const now = Date.now();
      for (const [key, entry] of this.affinityMemo) {
        if (entry.expiresAt <= now) this.affinityMemo.delete(key);
      }
    }
    return value;
  }

  /** Recency-weighted genre affinity: genreId -> score.
   *  All top-artist lookups run concurrently — each is one or two external
   *  HTTP calls, so serializing them dominated feed latency. */
  private async genreAffinity(
    signal: Signal,
    itunes: ItunesAdapter,
    deezer: DeezerAdapter
  ): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    const top = [...signal.artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_ARTISTS);

    await Promise.all(
      top.map(async ([name, score]) => {
        let genreId: number | null = null;
        try {
          const found = await itunes.searchArtists(name, 1);
          const genreName = found[0]?.genres[0];
          if (genreName) genreId = await deezer.genreIdForName(genreName);
        } catch {
          // Fall through to the Deezer lookup below.
        }
        if (genreId == null) {
          try {
            genreId = await deezer.genreForArtist(name);
          } catch {
            // Best-effort.
          }
        }
        if (genreId != null) counts.set(genreId, (counts.get(genreId) ?? 0) + score);
      })
    );
    return counts;
  }

  private async genreLabel(
    deezer: DeezerAdapter,
    genreId: number,
    fallback: string
  ): Promise<string> {
    try {
      const name = await deezer.genreName(genreId);
      return name ?? fallback;
    } catch {
      return fallback;
    }
  }

  /** Chart tracks for a genre, supplemented by a keyword search when thin. */
  private async genrePool(
    deezer: DeezerAdapter,
    genreId: number,
    label: string
  ): Promise<CanonicalTrack[]> {
    let candidates: CanonicalTrack[] = [];
    try {
      candidates = await deezer.genreChartTracks(genreId, 50);
    } catch {
      // Fall through to the search supplement below.
    }
    if (candidates.length < 15) {
      try {
        candidates = [...candidates, ...(await deezer.searchTracks(label, 20))];
      } catch {
        // Best-effort supplement.
      }
    }
    return candidates;
  }

  private topGenreIds(affinity: Map<number, number>, limit: number): number[] {
    return [...affinity.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
  }

  private async buildDailyMixes(
    signal: Signal,
    affinity: Map<number, number>,
    itunes: ItunesAdapter,
    deezer: DeezerAdapter,
    previous: DailyMix[],
    excludeTracks: Set<string>
  ): Promise<DailyMix[]> {
    void itunes;
    const genreIds = this.topGenreIds(affinity, MAX_DAILY_MIXES);
    if (genreIds.length === 0) return [];

    const knownArtistNames = new Set(signal.artists.keys());
    const prevByGenre = new Map(previous.filter((m) => m.kind === 'daily').map((m) => [m.id, m]));
    const mixes: DailyMix[] = [];

    for (let i = 0; i < genreIds.length; i++) {
      const genreId = genreIds[i];
      const label = await this.genreLabel(deezer, genreId, `Mix ${i + 1}`);
      const candidates = await this.genrePool(deezer, genreId, label);
      const selected = selectMixTracks(candidates, knownArtistNames, excludeTracks, MIX_SIZE);
      if (selected.length < MIN_MIX_SIZE) continue;

      const id = `mix:${genreId}`;
      const tracks = applyGradualRefresh(selected, prevByGenre.get(id)?.tracks, MIX_REFRESH_KEEP);
      for (const t of tracks) excludeTracks.add(t.id);

      mixes.push({
        id,
        name: `Daily Mix ${i + 1}`,
        kind: 'daily',
        genre: label,
        description: `${label} tracks based on your listening.`,
        artworkUrl: tracks[0]?.artworkUrl,
        trackCount: tracks.length,
        tracks,
      });
    }
    return mixes;
  }

  /** Favorites Mix: favorited songs first, filled from their top genre. Hidden when there are no favorites. */
  private async buildFavoritesMix(
    signal: Signal,
    affinity: Map<number, number>,
    deezer: DeezerAdapter,
    excludeTracks: Set<string>
  ): Promise<DailyMix | null> {
    const favTracks = signal.familiar.filter((t) => signal.favoriteTrackIds.has(t.id));
    if (favTracks.length === 0) return null;

    let fill: CanonicalTrack[] = [];
    const genreIds = this.topGenreIds(affinity, 1);
    if (genreIds.length > 0) {
      const genreId = genreIds[0];
      const label = await this.genreLabel(deezer, genreId, '');
      fill = await this.genrePool(deezer, genreId, label);
    }

    const favSelected = interleaveByArtist(favTracks, MIX_SIZE);
    const excluded = new Set<string>([...excludeTracks, ...favSelected.map((t) => t.id)]);
    const fillSelected = selectMixTracks(
      fill,
      new Set(signal.artists.keys()),
      excluded,
      MIX_SIZE - favSelected.length
    );
    const tracks = [...favSelected, ...fillSelected];
    if (tracks.length < MIN_MIX_SIZE) return null;

    for (const t of tracks) excludeTracks.add(t.id);
    return {
      id: 'mix:favorites',
      name: 'Favorites Mix',
      kind: 'favorites',
      genre: 'Your favorites',
      description: "Songs you've favorited, plus a few we think you'll love.",
      artworkUrl: tracks[0]?.artworkUrl,
      trackCount: tracks.length,
      tracks,
    };
  }

  /** Artist Mixes: the artist's own songs (capped) plus similar-genre tracks. */
  private async buildArtistMixes(
    signal: Signal,
    deezer: DeezerAdapter,
    excludeTracks: Set<string>
  ): Promise<DailyMix[]> {
    const top = [...signal.artists.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_ARTIST_MIXES);
    const mixes: DailyMix[] = [];
    for (const [name] of top) {
      let own: CanonicalTrack[] = [];
      try {
        own = await deezer.searchTracks(`artist:"${name}"`, 10);
      } catch {
        // Best-effort.
      }
      const ownCapped = interleaveByArtist(own, 8).filter(
        (t) => (t.artists[0]?.name ?? '') === name
      );
      if (ownCapped.length < 3) continue;

      let genreId: number | null = null;
      try {
        genreId = await deezer.genreForArtist(name);
      } catch {
        // Best-effort.
      }
      let pool: CanonicalTrack[] = [];
      if (genreId != null) {
        const label = await this.genreLabel(deezer, genreId, name);
        pool = await this.genrePool(deezer, genreId, label);
      }

      const excluded = new Set<string>([...excludeTracks, ...ownCapped.map((t) => t.id)]);
      const fill = selectMixTracks(
        pool,
        new Set(signal.artists.keys()),
        excluded,
        MIX_SIZE - ownCapped.length
      ).filter((t) => (t.artists[0]?.name ?? '') !== name);
      const tracks = [...ownCapped, ...fill].slice(0, MIX_SIZE);
      if (tracks.length < MIN_MIX_SIZE) continue;

      for (const t of tracks) excludeTracks.add(t.id);
      mixes.push({
        id: `mix:artist:${name}`,
        name: `${name} Mix`,
        kind: 'artist',
        genre: 'Artist mix',
        description: `Songs by ${name} and similar artists.`,
        artworkUrl: ownCapped[0]?.artworkUrl,
        trackCount: tracks.length,
        tracks,
      });
    }
    return mixes;
  }

  /** Discovery Mix: only artists outside the user's known set, drawn from
   *  genres beyond the Daily Mixes so it introduces genuinely new territory. */
  private async buildDiscoveryMix(
    signal: Signal,
    affinity: Map<number, number>,
    deezer: DeezerAdapter,
    excludeTracks: Set<string>
  ): Promise<DailyMix | null> {
    const genreIds = [...affinity.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(MAX_DAILY_MIXES, MAX_DAILY_MIXES + 2)
      .map(([id]) => id);
    if (genreIds.length === 0) return null;

    const known = new Set(signal.artists.keys());
    const seen = new Set<string>();
    const freshOnly: CanonicalTrack[] = [];
    for (const genreId of genreIds) {
      const label = await this.genreLabel(deezer, genreId, '');
      const pool = await this.genrePool(deezer, genreId, label);
      for (const track of pool) {
        if (excludeTracks.has(track.id) || seen.has(track.id)) continue;
        seen.add(track.id);
        const artist = track.artists[0]?.name ?? '';
        if (known.has(artist)) continue;
        freshOnly.push(track);
      }
    }
    const tracks = interleaveByArtist(freshOnly, MIX_SIZE);
    if (tracks.length < MIN_MIX_SIZE) return null;

    for (const t of tracks) excludeTracks.add(t.id);
    return {
      id: 'mix:discovery',
      name: 'Discovery Mix',
      kind: 'discovery',
      genre: 'Fresh picks',
      description: "New music from artists you haven't heard yet.",
      artworkUrl: tracks[0]?.artworkUrl,
      trackCount: tracks.length,
      tracks,
    };
  }

  /** Starter mood mixes for users without a listening signal yet. */
  private async buildStarterMixes(
    deezer: DeezerAdapter,
    excludeTracks: Set<string>
  ): Promise<DailyMix[]> {
    const moods: Array<{ name: string; genreId: number; description: string }> = [
      { name: 'Chill Mix', genreId: 106, description: 'Smooth, laid-back tracks to unwind.' },
      { name: 'Workout Mix', genreId: 113, description: 'High-energy beats to keep you moving.' },
      { name: 'Party Mix', genreId: 173, description: 'Upbeat anthems for any celebration.' },
      { name: 'Focus Mix', genreId: 129, description: 'Instrumental favorites for deep focus.' },
    ];
    const mixes: DailyMix[] = [];
    for (const mood of moods) {
      const label = await this.genreLabel(deezer, mood.genreId, mood.name);
      const pool = await this.genrePool(deezer, mood.genreId, label);
      const tracks = selectMixTracks(pool, new Set<string>(), excludeTracks, MIX_SIZE);
      if (tracks.length < MIN_MIX_SIZE) continue;
      for (const t of tracks) excludeTracks.add(t.id);
      mixes.push({
        id: `mix:starter:${mood.name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
        name: mood.name,
        kind: 'mood',
        genre: label,
        description: mood.description,
        artworkUrl: tracks[0]?.artworkUrl,
        trackCount: tracks.length,
        tracks,
      });
    }
    return mixes;
  }

  /** Global starter mixes for the public home feed (signed-out / new users). */
  async buildStarterMixesPublic(deezer: DeezerAdapter): Promise<DailyMix[]> {
    return this.buildStarterMixes(deezer, new Set<string>());
  }

  /**
   * Builds all mixes for the user. Users without any signal get global starter
   * mixes; everyone else gets favorites + daily + artist + discovery mixes,
   * all deduped against each other (favorites build first so they are never
   * starved by the daily mixes sharing the same genre pools).
   */
  async buildMixes(
    userId: string,
    itunes: ItunesAdapter,
    deezer: DeezerAdapter,
    options: { library?: LibraryPayload; previous?: DailyMix[] } = {}
  ): Promise<DailyMix[]> {
    const signal = await this.loadSignal(userId, options.library);
    const hasSignal = signal.familiar.length > 0 || signal.artists.size > 0;
    const excludeTracks = new Set<string>(signal.heardIds);
    if (!hasSignal) return this.buildStarterMixes(deezer, excludeTracks);

    const affinity = await this.genreAffinityFor(userId, signal, itunes, deezer);
    const mixes: DailyMix[] = [];
    const favorites = await this.buildFavoritesMix(signal, affinity, deezer, excludeTracks);
    if (favorites) mixes.push(favorites);
    mixes.push(
      ...(await this.buildDailyMixes(
        signal,
        affinity,
        itunes,
        deezer,
        options.previous ?? [],
        excludeTracks
      ))
    );
    mixes.push(...(await this.buildArtistMixes(signal, deezer, excludeTracks)));
    const discovery = await this.buildDiscoveryMix(signal, affinity, deezer, excludeTracks);
    if (discovery) mixes.push(discovery);
    return mixes;
  }

  /** Recommended songs: song-radio around the user's top artist. */
  private async buildRecommendedSongs(
    signal: Signal,
    deezer: DeezerAdapter,
    excludeTracks: Set<string>
  ): Promise<HomeSection | null> {
    const top = [...signal.artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 1)[0];
    if (!top || top[1] <= 0) return null;
    const [seed] = top;

    let explanation = `Because you listen to ${seed}`;
    if (signal.favoriteArtists.has(seed)) explanation = 'Similar to your favorites';
    else if (signal.downloadedArtists.has(seed)) explanation = `Because you downloaded ${seed}`;

    let pool: CanonicalTrack[] = [];
    let genreId: number | null = null;
    try {
      genreId = await deezer.genreForArtist(seed);
    } catch {
      // Best-effort.
    }
    if (genreId != null) {
      const label = await this.genreLabel(deezer, genreId, seed);
      pool = await this.genrePool(deezer, genreId, label);
    }
    let own: CanonicalTrack[] = [];
    try {
      own = await deezer.searchTracks(`artist:"${seed}"`, 8);
    } catch {
      // Best-effort.
    }

    const tracks = selectMixTracks(
      [...own, ...pool],
      new Set(signal.artists.keys()),
      excludeTracks,
      15
    );
    if (tracks.length === 0) return null;
    for (const t of tracks) excludeTracks.add(t.id);
    return { kind: 'tracks', title: 'Recommended songs', explanation, tracks };
  }

  /** Recommended playlists: editorial playlists matching the user's top genres. */
  private async buildRecommendedPlaylists(
    signal: Signal,
    affinity: Map<number, number>,
    deezer: DeezerAdapter,
    excludePlaylists: Set<string>
  ): Promise<HomeSection | null> {
    const genreIds = this.topGenreIds(affinity, 3);
    const labels: string[] = [];
    for (const genreId of genreIds) {
      const label = await this.genreLabel(deezer, genreId, '');
      if (label) labels.push(label);
    }
    if (labels.length === 0) return null;

    const playlists: CanonicalPlaylist[] = [];
    for (const label of labels) {
      let found: CanonicalPlaylist[] = [];
      try {
        found = await deezer.searchPlaylists(label, 5);
      } catch {
        // Best-effort.
      }
      for (const playlist of found) {
        if (excludePlaylists.has(playlist.id) || playlists.some((p) => p.id === playlist.id))
          continue;
        excludePlaylists.add(playlist.id);
        playlists.push(playlist);
        if (playlists.length >= 8) break;
      }
      if (playlists.length >= 8) break;
    }
    if (playlists.length === 0) return null;
    return {
      kind: 'playlists',
      title: 'Recommended playlists',
      explanation: 'Based on your listening',
      playlists,
    };
  }

  /** Recommended albums: albums from the user's top artists. */
  private async buildRecommendedAlbums(
    signal: Signal,
    itunes: ItunesAdapter,
    excludeAlbums: Set<string>
  ): Promise<HomeSection | null> {
    const top = [...signal.artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    const albums: CanonicalAlbum[] = [];
    let seedArtist = '';
    for (const [name] of top) {
      if (!seedArtist) seedArtist = name;
      let found: CanonicalAlbum[] = [];
      try {
        found = await itunes.searchAlbums(name, 4);
      } catch {
        // Best-effort.
      }
      for (const album of found) {
        if (excludeAlbums.has(album.id) || albums.some((a) => a.id === album.id)) continue;
        excludeAlbums.add(album.id);
        albums.push(album);
      }
    }
    if (albums.length === 0) return null;
    const explanation = seedArtist
      ? `Because you listen to ${seedArtist}`
      : 'Based on your recent listening';
    return {
      kind: 'albums',
      title: 'Albums you might like',
      explanation,
      albums: albums.slice(0, 10),
    };
  }

  /** Recommended artists: top artists from the user's genres, excluding known names. */
  private async buildRecommendedArtists(
    signal: Signal,
    affinity: Map<number, number>,
    deezer: DeezerAdapter,
    excludeArtists: Set<string>
  ): Promise<HomeSection | null> {
    const genreIds = this.topGenreIds(affinity, 2);
    const known = new Set(signal.artists.keys());
    const artists: CanonicalArtist[] = [];
    for (const genreId of genreIds) {
      let found: CanonicalArtist[] = [];
      try {
        found = await deezer.genreArtists(genreId, 10);
      } catch {
        // Best-effort.
      }
      for (const artist of found) {
        if (
          known.has(artist.name) ||
          excludeArtists.has(artist.id) ||
          artists.some((a) => a.id === artist.id)
        )
          continue;
        excludeArtists.add(artist.id);
        artists.push(artist);
      }
    }
    if (artists.length === 0) return null;
    const explanation =
      signal.favoriteArtists.size > 0 ? 'Similar to your favorites' : 'From genres you listen to';
    return {
      kind: 'artists',
      title: 'Artists you might like',
      explanation,
      artists: artists.slice(0, 10),
    };
  }

  /** New releases: fresh albums from followed/favorite artists, filled with global charts. */
  private async buildNewReleases(
    signal: Signal,
    itunes: ItunesAdapter,
    deezer: DeezerAdapter,
    excludeAlbums: Set<string>
  ): Promise<Extract<HomeSection, { kind: 'albums' }>> {
    const personalizedNames = [
      ...new Set([...signal.favoriteArtists, ...signal.followedArtists]),
    ].slice(0, 3);
    const albums: CanonicalAlbum[] = [];
    for (const name of personalizedNames) {
      let found: CanonicalAlbum[] = [];
      try {
        found = await itunes.searchAlbums(name, 1);
      } catch {
        // Best-effort.
      }
      for (const album of found) {
        if (excludeAlbums.has(album.id) || albums.some((a) => a.id === album.id)) continue;
        excludeAlbums.add(album.id);
        albums.push(album);
      }
    }
    let chart: CanonicalAlbum[] = [];
    try {
      chart = await deezer.chartAlbums(12);
    } catch {
      // Best-effort.
    }
    for (const album of chart) {
      if (excludeAlbums.has(album.id) || albums.some((a) => a.id === album.id)) continue;
      excludeAlbums.add(album.id);
      albums.push(album);
    }
    if (albums.length === 0) return { kind: 'albums', title: 'New releases', albums: [] };
    const explanation = personalizedNames.length > 0 ? 'New from artists you like' : undefined;
    return { kind: 'albums', title: 'New releases', explanation, albums: albums.slice(0, 12) };
  }

  /** Recently downloaded tracks (most recent first). */
  private buildRecentlyAdded(signal: Signal): HomeSection | null {
    if (signal.downloadedTracks.length === 0) return null;
    return {
      kind: 'tracks',
      title: 'Recently added',
      explanation: 'Saved to your device.',
      tracks: signal.downloadedTracks.slice(0, 12),
    };
  }

  /** The user's own playlists: recently played first, then recently updated. */
  private buildQuickAccess(signal: Signal): HomeSection | null {
    if (signal.playlists.length === 0) return null;
    const rank = new Map(signal.recentlyPlayedPlaylistIds.map((id, i) => [id, i]));
    const sorted = [...signal.playlists]
      .sort((a, b) => {
        const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return ra - rb || b.updatedAt - a.updatedAt;
      })
      .slice(0, 8)
      .map(playlistFromLibrary);
    return { kind: 'quick-access', title: 'Your playlists', playlists: sorted };
  }

  /**
   * Builds the complete ordered Home feed for a signed-in user. Section order
   * follows usefulness: quick access → recently played → mixes →
   * recommendations → discovery → recently added → new releases → trending.
   * Ids are deduped across the whole feed; sections with no data are omitted.
   */
  async buildHomeFeed(
    userId: string,
    itunes: ItunesAdapter,
    deezer: DeezerAdapter,
    options: { library?: LibraryPayload; mixes?: DailyMix[] } = {}
  ): Promise<HomeFeedResponse> {
    const signal = await this.loadSignal(userId, options.library);
    const hasSignal = signal.familiar.length > 0 || signal.artists.size > 0;

    const excludeTracks = new Set<string>(signal.heardIds);
    const excludeAlbums = new Set<string>();
    const excludeArtists = new Set<string>();
    const excludePlaylists = new Set<string>();

    const mixes =
      options.mixes ??
      (await this.buildMixes(userId, itunes, deezer, { library: options.library }));
    for (const mix of mixes) {
      for (const track of mix.tracks) excludeTracks.add(track.id);
    }

    const affinity = await this.genreAffinityFor(userId, signal, itunes, deezer);

    const sections: HomeSection[] = [];

    const quickAccess = this.buildQuickAccess(signal);
    if (quickAccess) sections.push(quickAccess);

    const recentlyPlayed = signal.familiar.slice(0, 10);
    if (recentlyPlayed.length > 0) {
      sections.push({ kind: 'recently-played', title: 'Recently played', tracks: recentlyPlayed });
    }

    if (mixes.length > 0) sections.push({ kind: 'mixes', title: 'Made for you', mixes });

    // These four touch disjoint exclude sets, so they run concurrently.
    const [recommendedSongs, recommendedPlaylists, recommendedAlbums, recommendedArtists] =
      await Promise.all([
        this.buildRecommendedSongs(signal, deezer, excludeTracks),
        this.buildRecommendedPlaylists(signal, affinity, deezer, excludePlaylists),
        this.buildRecommendedAlbums(signal, itunes, excludeAlbums),
        this.buildRecommendedArtists(signal, affinity, deezer, excludeArtists),
      ]);
    if (recommendedSongs) sections.push(recommendedSongs);
    if (recommendedPlaylists) sections.push(recommendedPlaylists);
    if (recommendedAlbums) sections.push(recommendedAlbums);
    if (recommendedArtists) sections.push(recommendedArtists);

    const recentlyAdded = this.buildRecentlyAdded(signal);
    if (recentlyAdded) sections.push(recentlyAdded);

    const newReleases = await this.buildNewReleases(signal, itunes, deezer, excludeAlbums);
    if (newReleases.albums.length > 0) sections.push(newReleases);

    // Trending (global charts, real ranking data only).
    let chartTracks: CanonicalTrack[] = [];
    let chartArtists: CanonicalArtist[] = [];
    let chartPlaylists: CanonicalPlaylist[] = [];
    try {
      [chartTracks, chartArtists, chartPlaylists] = await Promise.all([
        deezer.chartTracks(20),
        deezer.chartArtists(10),
        deezer.chartPlaylists(8),
      ]);
    } catch {
      // Best-effort.
    }
    const trendingTracks = chartTracks.filter((t) => !excludeTracks.has(t.id)).slice(0, 12);
    if (trendingTracks.length > 0) {
      for (const t of trendingTracks) excludeTracks.add(t.id);
      sections.push({ kind: 'tracks', title: 'Trending songs', tracks: trendingTracks });
    }
    const trendingArtists = chartArtists.filter((a) => !excludeArtists.has(a.id)).slice(0, 10);
    if (trendingArtists.length > 0) {
      for (const a of trendingArtists) excludeArtists.add(a.id);
      sections.push({ kind: 'artists', title: 'Trending artists', artists: trendingArtists });
    }
    const trendingPlaylists = chartPlaylists.filter((p) => !excludePlaylists.has(p.id)).slice(0, 8);
    if (trendingPlaylists.length > 0) {
      for (const p of trendingPlaylists) excludePlaylists.add(p.id);
      sections.push({
        kind: 'playlists',
        title: 'Popular playlists',
        playlists: trendingPlaylists,
      });
    }

    return {
      sections: sections.slice(0, MAX_SECTIONS),
      personalized: hasSignal,
    };
  }

  /** Convenience for tests: full feed in one call. */
  async buildFeed(
    userId: string,
    itunes: ItunesAdapter,
    deezer: DeezerAdapter,
    options: { library?: LibraryPayload; mixes?: DailyMix[] } = {}
  ): Promise<HomeFeedResponse> {
    return this.buildHomeFeed(userId, itunes, deezer, options);
  }
}
