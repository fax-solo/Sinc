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
const MAX_SECTIONS = 12;
/** Recency half-life: a play 14 days ago counts half as much as one today. */
const RECENCY_HALF_LIFE_MS = 14 * 24 * 3600 * 1000;
/** Share of a mix's tracks kept when the mix regenerates (gradual refresh). */
const MIX_REFRESH_KEEP = 0.6;
/** Default discovery preference (0 = stay familiar, 1 = always new). */
const DISCOVERY_DEFAULT = 0.5;
/** Below this, the Discovery Mix is omitted entirely. */
const DISCOVERY_MIN = 0.2;
/** How much of a mix should come from unknown artists by default. */
const DEFAULT_FRESH_RATIO = 0.6;
/** Tracks skipped more than this share of their plays are de-ranked. */
const SKIP_HEAVY_RATIO = 0.7;
/** Multiplier applied to tracks/heavy genres the user has rejected. */
const DEMOTE_FACTOR = 0.2;
/** Boost for tracks the user listened all the way through. */
const LISTEN_THROUGH_BOOST = 1.25;
/** A thumbs-up adds ~3 extra play-weight. */
const THUMBS_UP_BOOST = 3;
/** Genre suppression kicks in once this many downvotes share a genre. */
const GENRE_SUPPRESSION_MIN = 2;
/** Multiplies a suppressed genre's affinity score. */
const GENRE_SUPPRESSION_FACTOR = 0.15;
/** On-device signal payload caps (defends against a huge/garbage body). */
const SIGNAL_CAPS = {
  playCounts: 300,
  artistPlayCounts: 100,
  skipCounts: 300,
  completedCounts: 300,
  thumbs: 300,
  hiddenTracks: 200,
  hiddenArtists: 50,
} as const;

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

/** On-device listening signals sent with the home payload. */
export interface LibrarySignals {
  playCounts?: Array<{ trackId: string; count: number; lastPlayedAt: number }>;
  artistPlayCounts?: Array<{ name: string; count: number }>;
  skipCounts?: Array<{ trackId: string; count: number }>;
  completedCounts?: Array<{ trackId: string; count: number }>;
  thumbs?: Array<{ targetId: string; value: 'up' | 'down' }>;
  hiddenTrackIds?: string[];
  hiddenArtistNames?: string[];
  discoveryPreference?: number;
}

/** Library summary sent by the mobile app (local playlists, downloads, follows, signals). */
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
  signals?: LibrarySignals;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function sanitizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.floor(value), 100_000));
}

function sanitizeId(value: unknown): string {
  return typeof value === 'string' ? value : '';
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

  let signals: LibrarySignals | undefined;
  const rawSignals = (body.signals ?? {}) as Record<string, unknown>;
  if (typeof rawSignals === 'object' && rawSignals !== null) {
    signals = {};
    if (Array.isArray(rawSignals.playCounts)) {
      signals.playCounts = rawSignals.playCounts
        .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
        .map((p) => ({
          trackId: sanitizeId(p.trackId),
          count: sanitizeCount(p.count),
          lastPlayedAt: typeof p.lastPlayedAt === 'number' ? p.lastPlayedAt : 0,
        }))
        .filter((p) => p.trackId.length > 0 && p.count > 0)
        .slice(0, SIGNAL_CAPS.playCounts);
    }
    if (Array.isArray(rawSignals.artistPlayCounts)) {
      signals.artistPlayCounts = rawSignals.artistPlayCounts
        .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
        .map((a) => ({
          name: sanitizeId(a.name),
          count: sanitizeCount(a.count),
        }))
        .filter((a) => a.name.length > 0 && a.count > 0)
        .slice(0, SIGNAL_CAPS.artistPlayCounts);
    }
    if (Array.isArray(rawSignals.skipCounts)) {
      signals.skipCounts = rawSignals.skipCounts
        .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
        .map((s) => ({
          trackId: sanitizeId(s.trackId),
          count: sanitizeCount(s.count),
        }))
        .filter((s) => s.trackId.length > 0 && s.count > 0)
        .slice(0, SIGNAL_CAPS.skipCounts);
    }
    if (Array.isArray(rawSignals.completedCounts)) {
      signals.completedCounts = rawSignals.completedCounts
        .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
        .map((c) => ({
          trackId: sanitizeId(c.trackId),
          count: sanitizeCount(c.count),
        }))
        .filter((c) => c.trackId.length > 0 && c.count > 0)
        .slice(0, SIGNAL_CAPS.completedCounts);
    }
    if (Array.isArray(rawSignals.thumbs)) {
      signals.thumbs = rawSignals.thumbs
        .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
        .map((t) => ({
          targetId: sanitizeId(t.targetId),
          value: t.value === 'down' ? ('down' as const) : ('up' as const),
        }))
        .filter((t) => t.targetId.length > 0)
        .slice(0, SIGNAL_CAPS.thumbs);
    }
    if (Array.isArray(rawSignals.hiddenTrackIds)) {
      signals.hiddenTrackIds = rawSignals.hiddenTrackIds
        .filter((x): x is string => typeof x === 'string' && x.length > 0)
        .slice(0, SIGNAL_CAPS.hiddenTracks);
    }
    if (Array.isArray(rawSignals.hiddenArtistNames)) {
      signals.hiddenArtistNames = rawSignals.hiddenArtistNames
        .filter((x): x is string => typeof x === 'string' && x.length > 0)
        .slice(0, SIGNAL_CAPS.hiddenArtists);
    }
    if (typeof rawSignals.discoveryPreference === 'number') {
      signals.discoveryPreference = clamp(rawSignals.discoveryPreference, 0, 1);
    }
    if (
      signals.playCounts === undefined &&
      signals.artistPlayCounts === undefined &&
      signals.skipCounts === undefined &&
      signals.completedCounts === undefined &&
      signals.thumbs === undefined &&
      signals.hiddenTrackIds === undefined &&
      signals.hiddenArtistNames === undefined &&
      signals.discoveryPreference === undefined
    ) {
      signals = undefined;
    }
  }

  return {
    playlists,
    recentlyPlayedPlaylistIds,
    downloadedTracks,
    followedArtists,
    followedAlbums,
    signals,
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
  /** On-device signals. */
  playStats: Map<string, { count: number; lastPlayedAt: number }>;
  skipCounts: Map<string, number>;
  completedCounts: Map<string, number>;
  thumbsUp: Set<string>;
  thumbsDown: Set<string>;
  thumbsUpArtists: Set<string>;
  thumbsDownArtists: Set<string>;
  hiddenTrackIds: Set<string>;
  hiddenArtistNames: Set<string>;
  discoveryPreference: number;
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

/** Engaagenment factor for a track id given the on-device signals. */
function engagementFactor(
  signal: Signal,
  trackId: string
): { factor: number; boosted: boolean; skipHeavy: boolean } {
  const stat = signal.playStats.get(trackId);
  const plays = stat?.count ?? 0;
  let base = plays > 0 ? 1 + 0.4 * Math.log1p(plays) : 1;
  const skips = signal.skipCounts.get(trackId) ?? 0;
  let skipHeavy = false;
  if (plays > 0 && skips / plays > SKIP_HEAVY_RATIO) {
    base *= DEMOTE_FACTOR;
    skipHeavy = true;
  }
  const done = signal.completedCounts.get(trackId) ?? 0;
  if (plays > 0 && done / plays >= 0.8) base *= LISTEN_THROUGH_BOOST;
  const boosted = signal.thumbsUp.has(trackId);
  if (boosted) base += THUMBS_UP_BOOST;
  return { factor: base, boosted, skipHeavy };
}

function isExcludedFromFeed(signal: Signal, trackId: string): boolean {
  if (signal.hiddenTrackIds.has(trackId)) return true;
  if (signal.thumbsDown.has(trackId)) return true;
  return false;
}

/** Ids that must never surface in mixes/recommendations/trending. */
function excludedTrackIds(signal: Signal): Set<string> {
  const ids = new Set<string>(signal.heardIds);
  for (const id of signal.hiddenTrackIds) ids.add(id);
  for (const id of signal.thumbsDown) {
    if (!id.startsWith('artist:') && !id.startsWith('mix:')) ids.add(id);
  }
  return ids;
}

/** Artist names the user has explicitly rejected (hidden or thumbs-down). */
function excludedArtistNames(signal: Signal): Set<string> {
  return new Set<string>([...signal.hiddenArtistNames, ...signal.thumbsDownArtists]);
}

/** 0..1 similarity: shared artist dominates, then album, then title tokens. */
function trackSimilarity(a: CanonicalTrack, b: CanonicalTrack): number {
  let s = 0;
  const aNames = new Set(a.artists.map((x) => x.name));
  const bNames = new Set(b.artists.map((x) => x.name));
  if ([...aNames].some((n) => bNames.has(n))) s += 0.6;
  if (a.album?.id && a.album.id === b.album?.id) s += 0.25;
  const ta = new Set((a.title ?? '').toLowerCase().split(/\s+/).filter(Boolean));
  const tb = new Set((b.title ?? '').toLowerCase().split(/\s+/).filter(Boolean));
  if (ta.size > 0 && tb.size > 0) {
    let shared = 0;
    for (const token of ta) if (tb.has(token)) shared += 1;
    s += 0.15 * (shared / Math.min(ta.size, tb.size));
  }
  return Math.min(1, s);
}

/**
 * Maximal marginal relevance selection: greedily picks the candidate that
 * maximizes `lambda * relevance + (1 - lambda) * diversity`. With uniform
 * scores this degrades gracefully to a max-diversity round-robin that keeps
 * pool order as a tie-breaker.
 */
function mmrSelect(
  candidates: CanonicalTrack[],
  limit: number,
  score: (track: CanonicalTrack, index: number) => number,
  lambda = 0.5
): CanonicalTrack[] {
  if (candidates.length === 0 || limit <= 0) return [];
  const scored = candidates.map((t, i) => ({ t, i, s: score(t, i) }));
  let min = Infinity;
  let max = -Infinity;
  for (const x of scored) {
    if (x.s < min) min = x.s;
    if (x.s > max) max = x.s;
  }
  const range = max - min || 1;
  const selected: CanonicalTrack[] = [];
  const remaining = [...scored];
  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let j = 0; j < remaining.length; j++) {
      const x = remaining[j];
      let maxSim = 0;
      for (const sel of selected) {
        const sim = trackSimilarity(sel, x.t);
        if (sim > maxSim) maxSim = sim;
      }
      const rank = (x.s - min) / range;
      const val = lambda * rank + (1 - lambda) * (1 - maxSim);
      if (val > bestVal) {
        bestVal = val;
        bestIdx = j;
      }
    }
    selected.push(remaining[bestIdx].t);
    remaining.splice(bestIdx, 1);
  }
  return selected;
}

/**
 * Picks mix tracks from candidates: never serves an excluded id, prefers
 * artists outside the user's known set, balances by the discovery pref, and
 * re-ranks the result with MMR so no single artist/album clusters the rail.
 */
function selectMixTracks(
  candidates: CanonicalTrack[],
  knownArtists: Set<string>,
  exclude: Set<string>,
  size: number,
  options: { freshRatio?: number; score?: (track: CanonicalTrack, index: number) => number } = {}
): CanonicalTrack[] {
  const freshRatio = clamp(options.freshRatio ?? DEFAULT_FRESH_RATIO, 0, 1);
  const freshCount = Math.min(size, Math.max(0, Math.round(size * freshRatio)));
  const knownCount = size - freshCount;
  const fresh: CanonicalTrack[] = [];
  const known: CanonicalTrack[] = [];
  const seen = new Set<string>();
  for (const track of candidates) {
    if (exclude.has(track.id) || seen.has(track.id)) continue;
    seen.add(track.id);
    const artist = track.artists[0]?.name ?? '';
    (knownArtists.has(artist) ? known : fresh).push(track);
  }
  const score = options.score ?? (() => 0);
  return [...mmrSelect(fresh, freshCount, score), ...mmrSelect(known, knownCount, score)].slice(
    0,
    size
  );
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

    const playStats = new Map<string, { count: number; lastPlayedAt: number }>();
    const skipCounts = new Map<string, number>();
    const completedCounts = new Map<string, number>();
    const thumbsUp = new Set<string>();
    const thumbsDown = new Set<string>();
    const thumbsUpArtists = new Set<string>();
    const thumbsDownArtists = new Set<string>();
    const hiddenTrackIds = new Set<string>();
    const hiddenArtistNames = new Set<string>();

    const dev = library.signals ?? {};
    for (const p of dev.playCounts ?? []) playStats.set(p.trackId, p);
    for (const s of dev.skipCounts ?? []) skipCounts.set(s.trackId, s.count);
    for (const c of dev.completedCounts ?? []) completedCounts.set(c.trackId, c.count);
    for (const t of dev.thumbs ?? []) {
      if (t.value === 'up') {
        thumbsUp.add(t.targetId);
        if (t.targetId.startsWith('artist:'))
          thumbsUpArtists.add(t.targetId.slice('artist:'.length));
      } else {
        thumbsDown.add(t.targetId);
        if (t.targetId.startsWith('artist:'))
          thumbsDownArtists.add(t.targetId.slice('artist:'.length));
      }
    }
    for (const id of dev.hiddenTrackIds ?? []) hiddenTrackIds.add(id);
    for (const name of dev.hiddenArtistNames ?? []) hiddenArtistNames.add(name);
    const discoveryPreference =
      typeof dev.discoveryPreference === 'number'
        ? clamp(dev.discoveryPreference, 0, 1)
        : DISCOVERY_DEFAULT;

    for (const row of history) {
      const track = trackFromHistory(row);
      if (track) {
        const weight = recencyWeight(row.playedAt, now);
        playWeights.set(track.id, Math.max(playWeights.get(track.id) ?? 0, weight));
        if (!heardIds.has(track.id)) {
          heardIds.add(track.id);
          familiar.push(track);
        }
        // A fresh play also registers in the on-device-style stats so the
        // server history feeds the new "On repeat" / "Your top songs" rails
        // the same way device counts would.
        const stat = playStats.get(track.id);
        playStats.set(track.id, {
          count: (stat?.count ?? 0) + 1,
          lastPlayedAt: Math.max(stat?.lastPlayedAt ?? 0, row.playedAt.getTime()),
        });
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
      playStats,
      skipCounts,
      completedCounts,
      thumbsUp,
      thumbsDown,
      thumbsUpArtists,
      thumbsDownArtists,
      hiddenTrackIds,
      hiddenArtistNames,
      discoveryPreference,
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
  /**
   * Learning loop: resolves thumbs-downed / hidden artist names to a genre and
   * returns genreId -> contributing artists. Once two or more downvotes share
   * a genre it is suppressed (see GENRE_SUPPRESSION_FACTOR). Best-effort and
   * capped so a huge downvote list can never stall the feed.
   */
  private async suppressedGenresFor(
    signal: Signal,
    deezer: DeezerAdapter
  ): Promise<Map<number, string[]>> {
    const artists = new Set<string>(signal.hiddenArtistNames);
    for (const target of signal.thumbsDown) {
      if (target.startsWith('artist:')) artists.add(target.slice('artist:'.length));
    }
    for (const id of [...signal.thumbsDown]
      .filter((t) => !t.startsWith('artist:') && !t.startsWith('mix:') && t.startsWith('deezer:'))
      .slice(0, 4)) {
      try {
        const found = await deezer.lookupTrack(id.slice('deezer:'.length));
        const name = found?.artists[0]?.name;
        if (name) artists.add(name);
      } catch {
        // Best-effort.
      }
    }
    const byGenre = new Map<number, string[]>();
    let authors = 0;
    for (const name of artists) {
      if (!name.trim()) continue;
      if (authors >= 12) break;
      authors += 1;
      let genreId: number | null = null;
      try {
        genreId = await deezer.genreForArtist(name);
      } catch {
        // Best-effort.
      }
      if (genreId != null) {
        const list = byGenre.get(genreId) ?? [];
        list.push(name);
        byGenre.set(genreId, list);
      }
    }
    return byGenre;
  }

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

    const suppressed = await this.suppressedGenresFor(signal, deezer);
    for (const [genreId, reasons] of suppressed) {
      if (reasons.length >= GENRE_SUPPRESSION_MIN && counts.has(genreId)) {
        counts.set(genreId, counts.get(genreId)! * GENRE_SUPPRESSION_FACTOR);
      }
    }
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

  /** Relevance + engagement score for a mix candidate. */
  private mixScore(signal: Signal, track: CanonicalTrack): number {
    const artist = track.artists[0]?.name ?? '';
    let s = 0;
    if (signal.thumbsUp.has(track.id)) s += THUMBS_UP_BOOST;
    if (artist && signal.thumbsUpArtists.has(artist)) s += 2;
    if (signal.favoriteTrackIds.has(track.id)) s += 1.5;
    s += engagementFactor(signal, track.id).factor - 1;
    if (artist) s += Math.log1p(signal.artists.get(artist) ?? 0);
    return s;
  }

  private freshRatioFor(preference: number): number {
    return 0.2 + 0.8 * clamp(preference, 0, 1);
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
    const genreIds = this.topGenreIds(affinity, MAX_DAILY_MIXES).filter(
      (genreId) => !signal.thumbsDown.has(`mix:${genreId}`)
    );
    if (genreIds.length === 0) return [];

    const knownArtistNames = new Set(signal.artists.keys());
    const prevByGenre = new Map(previous.filter((m) => m.kind === 'daily').map((m) => [m.id, m]));
    const mixes: DailyMix[] = [];

    for (let i = 0; i < genreIds.length; i++) {
      const genreId = genreIds[i];
      const label = await this.genreLabel(deezer, genreId, `Mix ${i + 1}`);
      const candidates = await this.genrePool(deezer, genreId, label);
      const selected = selectMixTracks(candidates, knownArtistNames, excludeTracks, MIX_SIZE, {
        freshRatio: this.freshRatioFor(signal.discoveryPreference),
        score: (t) => this.mixScore(signal, t),
      });
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
    if (favTracks.length === 0 || signal.thumbsDown.has('mix:favorites')) return null;

    let fill: CanonicalTrack[] = [];
    const genreIds = this.topGenreIds(affinity, 1);
    if (genreIds.length > 0) {
      const genreId = genreIds[0];
      const label = await this.genreLabel(deezer, genreId, '');
      fill = await this.genrePool(deezer, genreId, label);
    }

    // Low discovery preference keeps the mix almost entirely favorited;
    // otherwise favorites lead and the top genre fills the rest.
    const favLimit = signal.discoveryPreference < 0.4 ? MIX_SIZE : Math.floor(MIX_SIZE * 0.6);
    const favSelected = mmrSelect(favTracks, favLimit, (t) => this.mixScore(signal, t));
    const excluded = new Set<string>([...excludeTracks, ...favSelected.map((t) => t.id)]);
    const fillSelected = selectMixTracks(
      fill,
      new Set(signal.artists.keys()),
      excluded,
      MIX_SIZE - favSelected.length,
      {
        freshRatio: this.freshRatioFor(signal.discoveryPreference),
        score: (t) => this.mixScore(signal, t),
      }
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
    const rejected = excludedArtistNames(signal);
    const mixes: DailyMix[] = [];
    for (const [name] of top) {
      if (rejected.has(name) || signal.thumbsDown.has(`mix:artist:${name}`)) continue;
      let own: CanonicalTrack[] = [];
      try {
        own = await deezer.searchTracks(`artist:"${name}"`, 10);
      } catch {
        // Best-effort.
      }
      const ownCapped = mmrSelect(own, 8, (t) => this.mixScore(signal, t)).filter(
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
        MIX_SIZE - ownCapped.length,
        {
          freshRatio: this.freshRatioFor(signal.discoveryPreference),
          score: (t) => this.mixScore(signal, t),
        }
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
    if (genreIds.length === 0 || signal.thumbsDown.has('mix:discovery')) return null;

    const known = new Set(signal.artists.keys());
    const rejected = excludedArtistNames(signal);
    const seen = new Set<string>();
    const freshOnly: CanonicalTrack[] = [];
    for (const genreId of genreIds) {
      const label = await this.genreLabel(deezer, genreId, '');
      const pool = await this.genrePool(deezer, genreId, label);
      for (const track of pool) {
        if (excludeTracks.has(track.id) || seen.has(track.id)) continue;
        seen.add(track.id);
        const artist = track.artists[0]?.name ?? '';
        if (known.has(artist) || rejected.has(artist)) continue;
        freshOnly.push(track);
      }
    }
    const tracks = mmrSelect(freshOnly, MIX_SIZE, (t) => this.mixScore(signal, t));
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
    const excluded = excludedTrackIds(signal);
    if (!hasSignal) return this.buildStarterMixes(deezer, excluded);

    const affinity = await this.genreAffinityFor(userId, signal, itunes, deezer);
    const mixes: DailyMix[] = [];
    const favorites = await this.buildFavoritesMix(signal, affinity, deezer, excluded);
    if (favorites) mixes.push(favorites);
    mixes.push(
      ...(await this.buildDailyMixes(
        signal,
        affinity,
        itunes,
        deezer,
        options.previous ?? [],
        excluded
      ))
    );
    mixes.push(...(await this.buildArtistMixes(signal, deezer, excluded)));
    // Discovery Mix follows the preference: omitted entirely for "stay
    // familiar" listeners, always present for high-preference explorers.
    if (signal.discoveryPreference > DISCOVERY_MIN) {
      const discovery = await this.buildDiscoveryMix(signal, affinity, deezer, excluded);
      if (discovery) mixes.push(discovery);
    }
    return mixes;
  }

  /** Recommended songs: genre pools + own songs around the user's top artists. */
  private async buildRecommendedSongs(
    signal: Signal,
    deezer: DeezerAdapter,
    excludeTracks: Set<string>
  ): Promise<HomeSection | null> {
    const top = [...signal.artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    if (top.length === 0 || top[0][1] <= 0) return null;
    const seed = top[0][0];

    let explanation = `Because you listen to ${seed}`;
    if (signal.thumbsUpArtists.has(seed)) explanation = `Because you liked ${seed}`;
    else if (signal.favoriteArtists.has(seed)) explanation = 'Similar to your favorites';
    else if (signal.downloadedArtists.has(seed)) explanation = `Because you downloaded ${seed}`;

    const excluded = excludedArtistNames(signal);
    // Two diverse seeds keep the rail from being dominated by one artist.
    const seeds = top.filter(([name]) => !excluded.has(name)).slice(0, 2);
    const candidates: CanonicalTrack[] = [];
    for (const [name] of seeds) {
      let genreId: number | null = null;
      try {
        genreId = await deezer.genreForArtist(name);
      } catch {
        // Best-effort.
      }
      if (genreId != null) {
        const label = await this.genreLabel(deezer, genreId, name);
        try {
          candidates.push(...(await this.genrePool(deezer, genreId, label)));
        } catch {
          // Best-effort.
        }
      }
      try {
        candidates.push(...(await deezer.searchTracks(`artist:"${name}"`, 8)));
      } catch {
        // Best-effort.
      }
    }

    const tracks = selectMixTracks(candidates, new Set(signal.artists.keys()), excludeTracks, 15, {
      freshRatio: this.freshRatioFor(signal.discoveryPreference),
      score: (t) => this.mixScore(signal, t),
    });
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
    const rejected = excludedArtistNames(signal);
    const top = [...signal.artists.entries()]
      .sort((a, b) => b[1] - a[1])
      .filter(([name]) => !rejected.has(name))
      .slice(0, 2);
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
    const rejected = excludedArtistNames(signal);
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
          rejected.has(artist.name) ||
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
    const rejected = excludedArtistNames(signal);
    const personalizedNames = [...new Set([...signal.favoriteArtists, ...signal.followedArtists])]
      .filter((name) => !rejected.has(name))
      .slice(0, 3);
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
   * "On repeat" and "Your top songs": ranked from the play stats, deduped
   * internally, filtered for hidden/thumbs-down/skip-heavy tracks. Both rails
   * only appear once enough distinct qualifying tracks exist.
   */
  private async buildRepeatSections(signal: Signal, deezer: DeezerAdapter): Promise<HomeSection[]> {
    if (signal.playStats.size === 0) return [];

    const idToTrack = new Map<string, CanonicalTrack>();
    for (const t of signal.familiar) idToTrack.set(t.id, t);
    for (const t of signal.downloadedTracks) if (!idToTrack.has(t.id)) idToTrack.set(t.id, t);

    const now = Date.now();
    const ranked: Array<{ track: CanonicalTrack; count: number; recency: number }> = [];
    const missingIds: string[] = [];
    for (const [id, stat] of signal.playStats) {
      const known = idToTrack.get(id);
      if (known) {
        ranked.push({
          track: known,
          count: stat.count,
          recency: recencyWeight(new Date(stat.lastPlayedAt), now),
        });
      } else if (id.startsWith('deezer:') && missingIds.length < 5) {
        missingIds.push(id);
      }
    }
    if (missingIds.length > 0) {
      await Promise.all(
        missingIds.map(async (id) => {
          try {
            const found = await deezer.lookupTrack(id.slice('deezer:'.length));
            if (found) {
              idToTrack.set(id, found);
              const stat = signal.playStats.get(id);
              if (stat) {
                ranked.push({
                  track: found,
                  count: stat.count,
                  recency: recencyWeight(new Date(stat.lastPlayedAt), now),
                });
              }
            }
          } catch {
            // Best-effort; un-resolvable tracks are skipped.
          }
        })
      );
    }

    const excluded = excludedArtistNames(signal);
    const qualifying = ranked
      .filter((r) => {
        if (isExcludedFromFeed(signal, r.track.id)) return false;
        const artist = r.track.artists[0]?.name ?? '';
        if (excluded.has(artist)) return false;
        return (
          !engagementFactor(signal, r.track.id).skipHeavy &&
          !signal.hiddenArtistNames.has(artist) &&
          !signal.thumbsDownArtists.has(artist)
        );
      })
      .sort((a, b) => b.count - a.count || b.recency - a.recency)
      .slice(0, 10);

    const sections: HomeSection[] = [];
    const onRepeat = qualifying
      .filter((r) => r.count >= 2)
      .sort((a, b) => b.count * b.recency - a.count * a.recency);
    if (onRepeat.length >= 3) {
      sections.push({
        kind: 'tracks',
        title: 'On repeat',
        tracks: onRepeat.map((r) => r.track),
      });
    }
    if (qualifying.length >= 3) {
      sections.push({
        kind: 'tracks',
        title: 'Your top songs',
        explanation: 'Most played, ranked by your listening.',
        tracks: qualifying.map((r) => r.track),
      });
    }
    return sections;
  }

  /**
   * Builds the complete ordered Home feed for a signed-in user. Section order
   * follows usefulness: quick access → recently played → on repeat / top →
   * mixes → recommendations → recently added → new releases → trending.
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

    const excludeTracks = excludedTrackIds(signal);
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

    const repeatSections = await this.buildRepeatSections(signal, deezer);
    for (const section of repeatSections) {
      if (section.kind === 'tracks') {
        for (const t of section.tracks) excludeTracks.add(t.id);
      }
    }
    for (const section of repeatSections) sections.push(section);

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
    const rejectedArtists = excludedArtistNames(signal);
    const trendingArtists = chartArtists
      .filter((a) => !excludeArtists.has(a.id) && !rejectedArtists.has(a.name))
      .slice(0, 10);
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

  /**
   * Recommendation-quality diagnostics (admin). Rebuilds the feed with the
   * same engines and reports how the sections were composed so the quality of
   * the recommendations can be measured, not guessed.
   */
  async diagnostics(
    userId: string,
    itunes: ItunesAdapter,
    deezer: DeezerAdapter,
    options: { library?: LibraryPayload } = {}
  ): Promise<FeedDiagnostics> {
    const signal = await this.loadSignal(userId, options.library);
    const affinity = await this.genreAffinityFor(userId, signal, itunes, deezer);
    const mixes = await this.buildMixes(userId, itunes, deezer, {
      library: options.library,
      previous: undefined,
    });
    const feed = await this.buildHomeFeed(userId, itunes, deezer, {
      library: options.library,
      mixes,
    });

    const knownArtistNames = new Set<string>(signal.artists.keys());
    const suppressedGenres: Array<{ genreId: number; count: number; artists: string[] }> = [];
    const suppressed = await this.suppressedGenresFor(signal, deezer);
    for (const [genreId, artists] of suppressed) {
      if (artists.length >= GENRE_SUPPRESSION_MIN) {
        suppressedGenres.push({ genreId, count: artists.length, artists });
      }
    }

    const mixRows = mixes.map((m) => {
      const fresh = m.tracks.filter((t) => !knownArtistNames.has(t.artists[0]?.name ?? '')).length;
      return {
        id: m.id,
        size: m.tracks.length,
        fresh,
        known: m.tracks.length - fresh,
      };
    });

    const sections = feed.sections.map((s, index) => {
      const sectionTracks: CanonicalTrack[] =
        s.kind === 'tracks' || s.kind === 'recently-played'
          ? s.tracks
          : s.kind === 'mixes'
            ? s.mixes.flatMap((m) => m.tracks)
            : [];
      const fresh = sectionTracks.filter(
        (t) => !knownArtistNames.has(t.artists[0]?.name ?? '')
      ).length;
      const boosted = sectionTracks.filter((t) => signal.thumbsUp.has(t.id)).length;
      return {
        index,
        kind: s.kind,
        title: s.title,
        size: sectionTracks.length,
        fresh,
        known: sectionTracks.length - fresh,
        thumbsUpBoosted: boosted,
      };
    });

    const onRepeat = [...signal.playStats.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([trackId, stat]) => ({ trackId, plays: stat.count, lastPlayedAt: stat.lastPlayedAt }));

    return {
      generatedAt: Date.now(),
      personalized: feed.personalized,
      signal: {
        knownArtists: knownArtistNames.size,
        playStatsTracks: signal.playStats.size,
        thumbsUp: signal.thumbsUp.size,
        thumbsDown: signal.thumbsDown.size,
        hiddenTracks: signal.hiddenTrackIds.size,
        hiddenArtists: signal.hiddenArtistNames.size,
        discoveryPreference: signal.discoveryPreference,
        favoriteTracks: signal.favoriteTrackIds.size,
        downloadedTracks: signal.downloadedTrackIds.size,
      },
      seeds: {
        topArtists: [...signal.artists.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, score]) => ({ name, score })),
        topGenres: [...affinity.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([genreId, score]) => ({ genreId, score })),
        onRepeat,
      },
      learning: {
        suppressedGenres,
        excludedArtists: [...excludedArtistNames(signal)],
        excludedTrackCount: [...signal.thumbsDown, ...signal.hiddenTrackIds].filter(
          (id) => !id.startsWith('artist:') && !id.startsWith('mix:')
        ).length,
      },
      sections,
      mixes: mixRows,
    };
  }
}

export interface FeedDiagnostics {
  generatedAt: number;
  personalized: boolean;
  signal: {
    knownArtists: number;
    playStatsTracks: number;
    thumbsUp: number;
    thumbsDown: number;
    hiddenTracks: number;
    hiddenArtists: number;
    discoveryPreference: number;
    favoriteTracks: number;
    downloadedTracks: number;
  };
  seeds: {
    topArtists: Array<{ name: string; score: number }>;
    topGenres: Array<{ genreId: number; score: number }>;
    onRepeat: Array<{ trackId: string; plays: number; lastPlayedAt: number }>;
  };
  learning: {
    suppressedGenres: Array<{ genreId: number; count: number; artists: string[] }>;
    excludedArtists: string[];
    excludedTrackCount: number;
  };
  sections: Array<{
    index: number;
    kind: string;
    title: string;
    size: number;
    fresh: number;
    known: number;
    thumbsUpBoosted: number;
  }>;
  mixes: Array<{ id: string; size: number; fresh: number; known: number }>;
}
