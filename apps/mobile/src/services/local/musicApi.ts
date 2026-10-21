/**
 * The local music API. Replaces the server HTTP client with direct provider
 * access: iTunes + Deezer for the catalog, LRCLIB for lyrics, the on-device
 * yt-dlp module for streaming/download sources, and an Internet Archive /
 * Jamendo / FMA chain for keyless downloads. Play/mix history and "Made for
 * you" sections are computed on-device from the library store.
 *
 * Screens keep importing from `../../api/music`, which re-exports this module.
 */
import type {
  CanonicalAlbum,
  CanonicalArtist,
  CanonicalPlaylist,
  CanonicalTrack,
  TrackLyrics,
} from '@sinc/shared';
import { config } from '../../app/config';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { deezer, isDeezerId, stripDeezerPrefix } from '../../services/providers/deezer';
import { itunes, stripItunesPrefix } from '../../services/providers/itunes';
import { lrclib } from '../../services/providers/lrclib';
import { providerFetchText } from '../../services/providers/http';
import {
  findArchiveSource,
  findFmaSource,
  findJamendoSource,
} from '../../services/providers/download-source';
import { resolveByQuery, resolveStream } from '../../services/providers/yt';
import {
  blacklistedTrackIds,
  computeArtistAffinity,
  hasUsefulAffinity,
  hashString,
  localDayKey,
  mulberry32,
  shuffled,
  type AffinityEvidence,
  type ArtistAffinity,
} from './affinity';
import { MIX_SIZE, MOOD_POOL, pickMoodsForDay, selectMixTracks } from './mixSelection';

export interface SearchResults {
  tracks?: { data: Array<{ track: CanonicalTrack; score: number }>; meta: unknown };
  artists?: { data: CanonicalArtist[]; meta: unknown };
  albums?: { data: CanonicalAlbum[]; meta: unknown };
  playlists?: { data: CanonicalPlaylist[]; meta: unknown };
}

export type SearchType = 'all' | 'tracks' | 'artists' | 'albums' | 'playlists';

export interface PlaybackSource {
  uri: string;
  headers?: Record<string, string>;
  mimeType?: string;
  quality: 'low' | 'medium' | 'high' | 'lossless';
  provider: string;
  expiresIn?: number;
}

export interface HomeFeed {
  popularTracks: CanonicalTrack[];
  newAlbums: CanonicalAlbum[];
  topPlaylists: CanonicalPlaylist[];
  topArtists: CanonicalArtist[];
  starterMixes: DailyMix[];
}

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

export interface PersonalizedHomeFeed {
  sections: HomeSection[];
  personalized: boolean;
}

export interface LibrarySignals {
  playCounts: Array<{ trackId: string; count: number; lastPlayedAt: number }>;
  artistPlayCounts: Array<{ name: string; count: number }>;
  skipCounts: Array<{ trackId: string; count: number }>;
  completedCounts: Array<{ trackId: string; count: number }>;
  thumbs: Array<{ targetId: string; value: 'up' | 'down' }>;
  hiddenTrackIds: string[];
  hiddenArtistNames: string[];
  discoveryPreference: number;
}

export interface LibraryPayload {
  playlists: Array<{
    id: string;
    name: string;
    artworkUrl?: string;
    trackCount: number;
    updatedAt: number;
  }>;
  recentlyPlayedPlaylistIds: string[];
  downloadedTracks: CanonicalTrack[];
  followedArtists: CanonicalArtist[];
  followedAlbums: CanonicalAlbum[];
  signals?: LibrarySignals;
}

export interface SpotifyImportPlaylist {
  id: string;
  name: string;
  owner: string;
  artworkUrl: string | null;
  totalCount: number;
  truncated: boolean;
}

export interface SpotifyImportResult {
  playlist: SpotifyImportPlaylist;
  tracks: CanonicalTrack[];
  counts: {
    fetched: number;
    matched: number;
    unresolved: number;
    duplicates: number;
  };
}

/** --- text matching helpers (mirror server routes.ts) ---------------------- */

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isNonLatin(query: string): boolean {
  return (
    /[\u0600-\u06FF\u0590-\u05FF\uAC00-\uD7AF\u3040-\u30FF\u0370-\u03FF\u0400-\u04FF]/.test(
      query
    ) || /[\u0900-\u097F]/.test(query)
  );
}

function score(query: string, track: CanonicalTrack): number {
  const q = normalizeText(query);
  const title = normalizeText(track.title);
  let s = 0;
  if (title === q) s += 100;
  else if (title.startsWith(q)) s += 80;
  else if (title.includes(q)) s += 60;
  if (track.artists.some((a) => a.name.toLowerCase().includes(q))) s += 40;
  return s;
}

function mergeTrackResults(a: CanonicalTrack[], b: CanonicalTrack[]): CanonicalTrack[] {
  const merged: CanonicalTrack[] = [];
  const seen = new Set<string>();
  for (const track of [...a, ...b]) {
    const key = `${normalizeText(track.title)}|${normalizeText(track.artists[0]?.name ?? '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(track);
  }
  return merged;
}

/** --- daily mix building (deterministic; see mixSelection.ts) --------------- */

/**
 * Cold-start mixes rotate through MOOD_POOL with a day-seeded rotation, so a
 * brand-new user (no listening history) still gets fresh variety instead of
 * the same four hardcoded moods every single day. Selection itself is
 * seeded, so the mixes are stable within the day and change tomorrow.
 */
export async function buildStarterMixes(nowMs?: number): Promise<DailyMix[]> {
  const dayKey = localDayKey(nowMs ?? Date.now());
  const rand = mulberry32(hashString(`sinc-starter:${dayKey}`));
  const moods = pickMoodsForDay(MOOD_POOL, hashString(dayKey), 4);
  const mixes = await Promise.all(
    moods.map(async (mood): Promise<DailyMix | null> => {
      try {
        let pool = await deezer
          .genreChartTracks(mood.genreId, 50)
          .catch(() => [] as CanonicalTrack[]);
        if (pool.length < 15) {
          const extra = await deezer
            .searchTracks(mood.search, 20)
            .catch(() => [] as CanonicalTrack[]);
          pool = dedupePool([...pool, ...extra]);
        }
        if (pool.length < 5) return null;
        const tracks = selectMixTracks(shuffled(pool, rand), MIX_SIZE, () => 0);
        if (tracks.length === 0) return null;
        return {
          id: `mix:starter:${mood.name.toLowerCase().replace(/\s+/g, '-')}`,
          name: `${mood.name}`,
          kind: 'mood' as MixKind,
          genre: mood.name,
          description: `The best of ${mood.name.toLowerCase()} today`,
          trackCount: tracks.length,
          tracks,
        };
      } catch {
        return null;
      }
    })
  );
  return mixes.filter((m): m is DailyMix => m !== null);
}

function dedupePool(tracks: CanonicalTrack[]): CanonicalTrack[] {
  const seen = new Set<string>();
  const out: CanonicalTrack[] = [];
  for (const t of tracks) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

/** Dedupes items across home sections so nothing repeats on the page. */
export function dedupeSections(sections: HomeSection[]): HomeSection[] {
  const seenTracks = new Set<string>();
  const seenAlbums = new Set<string>();
  const seenArtists = new Set<string>();
  const seenPlaylists = new Set<string>();
  const result: HomeSection[] = [];
  for (const section of sections) {
    let next = section;
    switch (section.kind) {
      case 'tracks':
      case 'recently-played': {
        const tracks = section.tracks.filter((t) => {
          if (seenTracks.has(t.id)) return false;
          seenTracks.add(t.id);
          return true;
        });
        if (tracks.length === 0) continue;
        next = { ...section, tracks };
        break;
      }
      case 'albums': {
        const albums = section.albums.filter((a) => {
          if (seenAlbums.has(a.id)) return false;
          seenAlbums.add(a.id);
          return true;
        });
        if (albums.length === 0) continue;
        next = { ...section, albums };
        break;
      }
      case 'artists': {
        const artists = section.artists.filter((a) => {
          if (seenArtists.has(a.id)) return false;
          seenArtists.add(a.id);
          return true;
        });
        if (artists.length === 0) continue;
        next = { ...section, artists };
        break;
      }
      case 'playlists':
      case 'quick-access': {
        const playlists = section.playlists.filter((p) => {
          if (seenPlaylists.has(p.id)) return false;
          seenPlaylists.add(p.id);
          return true;
        });
        if (playlists.length === 0) continue;
        next = { ...section, playlists };
        break;
      }
      case 'mixes':
        break;
    }
    result.push(next);
  }
  return result;
}

/** --- local home feed (mirror server routes.ts GET /music/home) -------------- */

export async function getHomeFeedLocal(): Promise<HomeFeed> {
  const [chartTracks, chartAlbums, chartPlaylists, chartArtists, starterMixes] = await Promise.all([
    deezer.chartTracks(50).catch(() => [] as CanonicalTrack[]),
    deezer.chartAlbums(25).catch(() => [] as CanonicalAlbum[]),
    deezer.chartPlaylists(10).catch(() => [] as CanonicalPlaylist[]),
    deezer.chartArtists(10).catch(() => [] as CanonicalArtist[]),
    buildStarterMixes(),
  ]);

  const popularTracks =
    chartTracks.length > 0 ? chartTracks : await itunes.searchTracks('trending music', 10);
  const newAlbums =
    chartAlbums.length > 0 ? chartAlbums : await itunes.searchAlbums('new releases', 12);
  const topPlaylists =
    chartPlaylists.length > 0 ? chartPlaylists : await itunes.searchPlaylists('top playlists', 10);
  const topArtists =
    chartArtists.length > 0 ? chartArtists : await itunes.searchArtists('popular artists', 10);

  return { popularTracks, newAlbums, topPlaylists, topArtists, starterMixes };
}

/** --- personalized home feed (on-device approximation of the engine) -------- */

const MAX_SECTIONS = 12;
/** Provider page size for search: one 25-item page per source per request. */
const SEARCH_FETCH_LIMIT = 25;

/** Apple `primaryGenreName` → Deezer chart genre ids for mix pools. */
const GENRE_IDS: Record<string, number> = {
  chill: 106,
  electronic: 106,
  ambient: 106,
  workout: 113,
  party: 173,
  pop: 132,
  dance: 132,
  rock: 152,
  alternative: 152,
  indie: 152,
  'hip hop': 116,
  'r&b': 116,
  rap: 116,
  'hip-hop': 116,
  folk: 124,
  metal: 152,
  jazz: 62,
  classical: 99,
  country: 113,
  focus: 129,
  'lo-fi': 106,
  // Additions so common Apple genre names don't silently drop artists
  // (the old table had ~20 entries and anything unmapped fell back to the
  // generic starter mixes).
  rnb: 165,
  soul: 165,
  funk: 165,
  reggae: 166,
  latin: 197,
  'latin pop': 197,
  worldwide: 197,
  'k-pop': 155,
  kpop: 155,
  'j-pop': 156,
  jpop: 156,
};

/** Genre-id lookup that tolerates naming variants ("hip-hop/rap", "Pop Rock"). */
function genreIdFor(genreName: string): number | null {
  const key = genreName.toLowerCase().trim();
  if (GENRE_IDS[key] !== undefined) return GENRE_IDS[key];
  const parent = key.split(/[/-]/)[0]?.trim() ?? key;
  if (GENRE_IDS[parent] !== undefined) return GENRE_IDS[parent];
  const broad = key.replace(/(music|hits|classics|songs)/g, '').trim();
  if (GENRE_IDS[broad] !== undefined) return GENRE_IDS[broad];
  return null;
}

/** Where a top artist's Apple genre label maps on Deezer; null = unmappable. */
function genreLabelFor(genreName: string): { label: string; id: number } | null {
  const id = genreIdFor(genreName);
  if (id === null) return null;
  return { label: genreName, id };
}

interface LocalEvidence extends AffinityEvidence {
  favoriteTracks: CanonicalTrack[];
  recentTracks: CanonicalTrack[];
  downloadedTracks: CanonicalTrack[];
}

/** Collects everything on-device that can explain "this listener likes X". */
function buildLocalEvidence(nowMs: number): LocalEvidence {
  const library = useLibraryStore.getState();
  const downloads = useDownloadsStore
    .getState()
    .downloads.filter((d) => d.phase === 'completed' && d.track);

  const trackArtists = new Map<string, string>();
  const knownTracks = new Map<string, CanonicalTrack>();
  const addTracks = (list: CanonicalTrack[]) => {
    for (const t of list) {
      if (!t?.id) continue;
      knownTracks.set(t.id, t);
      const artist = t.artists[0]?.name;
      if (artist && !trackArtists.has(t.id)) trackArtists.set(t.id, artist);
    }
  };
  addTracks(library.recentlyPlayed);
  addTracks(library.favoriteTracks);
  addTracks(downloads.map((d) => d.track));

  const familiarArtistNames = [...library.followedArtists.map((a) => a.name)];
  const favoriteArtistNames = [
    ...new Set(
      library.favoriteTracks.map((t) => t.artists[0]?.name ?? '').filter(Boolean) as string[]
    ),
  ].filter((n) => !familiarArtistNames.includes(n));

  return {
    trackArtists,
    knownTracks,
    familiarArtistNames,
    favoriteArtistNames,
    recentTracks: library.recentlyPlayed,
    favoriteTracks: library.favoriteTracks,
    downloadedTracks: downloads.map((d) => d.track),
    nowMs,
  };
}

/** Session cache for the Apple genre lookup — repeated per-day rebuilds
 *  used to hit iTunes for every top artist on each feed refresh. */
const artistGenreCache = new Map<string, { label: string; id: number } | null>();

async function artistGenre(name: string): Promise<{ label: string; id: number } | null> {
  const key = name.toLowerCase();
  const cached = artistGenreCache.get(key);
  if (cached !== undefined) return cached;
  let mapped: { label: string; id: number } | null = null;
  try {
    const artist = await itunes.findArtist(name);
    if (artist?.genres[0]) mapped = genreLabelFor(artist.genres[0]);
  } catch {
    mapped = null;
  }
  artistGenreCache.set(key, mapped);
  return mapped;
}

async function buildMixesFromSignals(
  affinity: ArtistAffinity[],
  signals: LibrarySignals | undefined,
  local: LocalEvidence,
  discovery: number
): Promise<DailyMix[]> {
  if (!hasUsefulAffinity(affinity)) return [];

  const rand = mulberry32(hashString(`sinc-mix:${localDayKey(local.nowMs)}`));
  const blocked = blacklistedTrackIds(signals);
  const hiddenLower = new Set((signals?.hiddenArtistNames ?? []).map((h) => h.toLowerCase()));
  const scoreByName = new Map(affinity.map((a) => [a.name.toLowerCase(), a.score]));

  // Group the top (recency-aware) artists into genre clusters; the seed
  // artist names the cluster, and at most 2 artists per cluster contribute
  // candidate pools.
  const clusters = new Map<number, { label: string; artists: string[] }>();
  for (const a of affinity.slice(0, 6)) {
    if (a.score <= 0) continue;
    const genre = await artistGenre(a.name);
    if (!genre) continue;
    const cluster = clusters.get(genre.id);
    if (cluster) {
      if (cluster.artists.length < 2) cluster.artists.push(a.name);
    } else {
      clusters.set(genre.id, { label: genre.label, artists: [a.name] });
    }
  }

  const mixes: DailyMix[] = [];
  for (const [genreId, info] of clusters) {
    if (mixes.length >= 4) break;
    try {
      let pool = await deezer.genreChartTracks(genreId, 50);
      for (const artistName of info.artists) {
        const extra = await deezer
          .searchTracks(`artist:"${artistName}"`, 15)
          .catch(() => [] as CanonicalTrack[]);
        pool = dedupePool([...pool, ...extra]);
      }
      const filtered = pool.filter((t) => {
        if (blocked.has(t.id)) return false;
        const lead = t.artists[0]?.name ?? '';
        return lead.length > 0 && !hiddenLower.has(lead.toLowerCase());
      });
      if (filtered.length < 5) continue;
      const liked = new Set(info.artists.map((n) => n.toLowerCase()));
      const tracks = selectMixTracks(shuffled(filtered, rand), MIX_SIZE, (t) => {
        const lead = (t.artists[0]?.name ?? '').toLowerCase();
        const affinityScore = scoreByName.get(lead) ?? 0;
        if (liked.has(lead)) return Math.max(affinityScore, 1.2);
        // Unknown artists: near-zero affinity — the discovery slider is
        // what lets them in, so stopping playback of the slider still
        // biases mixes toward familiar artists.
        return affinityScore * 0.4 + discovery;
      });
      if (tracks.length < 5) continue;
      mixes.push({
        id: `mix:${genreId}`,
        name: `Made for you: ${info.label}`,
        kind: 'daily' as MixKind,
        genre: info.label,
        trackCount: tracks.length,
        tracks,
      });
    } catch {
      continue;
    }
  }
  return mixes.slice(0, 4);
}

/** Builds "Made for you" + recommendations. Now driven by the full signal
 *  set: track starts + completions with recency decay, thumbs, follows, and
 *  the discovery slider. Zero-network rails (favorites/recent, downloads)
 *  keep the feed meaningful even when every provider call fails — the old
 *  version could collapse to just "Trending" on any network outage. */
async function buildPersonalizedSections(
  affinity: ArtistAffinity[],
  signals: LibrarySignals | undefined,
  local: LocalEvidence,
  discovery: number
): Promise<HomeSection[]> {
  const sections: HomeSection[] = [];
  const blocked = blacklistedTrackIds(signals);
  const hiddenLower = new Set((signals?.hiddenArtistNames ?? []).map((h) => h.toLowerCase()));
  const usable = (t: CanonicalTrack): boolean => {
    if (blocked.has(t.id)) return false;
    const lead = t.artists[0]?.name ?? '';
    return lead.length > 0 && !hiddenLower.has(lead.toLowerCase());
  };

  // 1) Daily mixes (or rotating starters for cold-start listeners).
  let mixes = await buildMixesFromSignals(affinity, signals, local, discovery);
  if (mixes.length === 0 && !hasUsefulAffinity(affinity)) {
    mixes = await buildStarterMixes(local.nowMs);
  }
  if (mixes.length > 0) {
    sections.push({ kind: 'mixes', title: 'Made for you', mixes });
  }

  // 2) Zero-network rail: jump back in (favorites first, then recent).
  const seenIds = new Set<string>();
  const revisit: CanonicalTrack[] = [];
  for (const t of [...local.favoriteTracks, ...local.recentTracks]) {
    if (revisit.length >= 12) break;
    if (seenIds.has(t.id)) continue;
    seenIds.add(t.id);
    if (!usable(t)) continue;
    revisit.push(t);
  }
  if (revisit.length >= 3) {
    sections.push({ kind: 'tracks', title: 'Jump back in', tracks: revisit });
  }

  // 3) "Because you listen to" rails, ranked by affinity, not raw count.
  for (const a of affinity.slice(0, 2)) {
    try {
      const tracks = (
        await deezer.searchTracks(`artist:"${a.name}"`, 15).catch(() => [] as CanonicalTrack[])
      )
        .filter(usable)
        .slice(0, 12);
      if (tracks.length > 0) {
        sections.push({
          kind: 'tracks',
          title: 'Because you listen to',
          explanation: a.name,
          tracks,
        });
      }
      const albums = await itunes.searchAlbums(a.name, 4).catch(() => [] as CanonicalAlbum[]);
      if (albums.length > 0) {
        sections.push({ kind: 'albums', title: `From ${a.name}`, albums: albums.slice(0, 10) });
      }
    } catch {
      continue;
    }
  }

  // 4) Fresh finds — the discovery half of the taste slider. Only new
  //    artists the listener has no history with.
  if (discovery >= 0.45) {
    try {
      const familiar = new Set(affinity.slice(0, 12).map((a) => a.name.toLowerCase()));
      const fresh = (await deezer.chartTracks(40).catch(() => [] as CanonicalTrack[]))
        .filter((t) => {
          if (!usable(t)) return false;
          return !familiar.has((t.artists[0]?.name ?? '').toLowerCase());
        })
        .slice(0, 12);
      if (fresh.length >= 5) {
        sections.push({
          kind: 'tracks',
          title: 'Fresh finds',
          explanation: 'Artists outside your usual orbit',
          tracks: fresh,
        });
      }
    } catch {
      // discovery rail is a bonus
    }
  }

  try {
    const trending = await deezer.chartTracks(20).catch(() => [] as CanonicalTrack[]);
    if (trending.length > 0) {
      sections.push({ kind: 'tracks', title: 'Trending songs', tracks: trending.slice(0, 12) });
    }
    const artists = await deezer.chartArtists(10).catch(() => [] as CanonicalArtist[]);
    if (artists.length > 0) {
      sections.push({ kind: 'artists', title: 'Trending artists', artists: artists.slice(0, 10) });
    }
    const playlists = await deezer.chartPlaylists(8).catch(() => [] as CanonicalPlaylist[]);
    if (playlists.length > 0) {
      sections.push({
        kind: 'playlists',
        title: 'Trending playlists',
        playlists: playlists.slice(0, 8),
      });
    }
  } catch {
    // charts are a bonus rail
  }

  // 5) Saved for you (downloads), skipping hidden/over-skipped tracks.
  const downloaded = local.downloadedTracks.filter(usable).slice(0, 12);
  if (downloaded.length > 0) {
    sections.push({ kind: 'tracks', title: 'Saved for you', tracks: downloaded });
  }

  return sections;
}

/** --- the local musicApi object -------------------------------------------- */

export const musicApi = {
  async getHomeFeed(): Promise<HomeFeed> {
    return getHomeFeedLocal();
  },

  async getPersonalizedHomeFeed(library: LibraryPayload): Promise<PersonalizedHomeFeed> {
    const signals = library.signals;
    const local = buildLocalEvidence(Date.now());
    const affinity = computeArtistAffinity(signals, {
      trackArtists: local.trackArtists,
      familiarArtistNames: local.familiarArtistNames,
      knownTracks: local.knownTracks,
      nowMs: local.nowMs,
    });
    const discovery = Math.min(1, Math.max(0, signals?.discoveryPreference ?? 0.5));
    let sections = await buildPersonalizedSections(affinity, signals, local, discovery);
    // Last-resort zero-network fallback: still show something sensible.
    if (sections.length === 0 && local.favoriteTracks.length > 0) {
      sections.push({
        kind: 'tracks',
        title: 'Jump back in',
        tracks: local.favoriteTracks.slice(0, 12),
      });
    }
    sections = sections.slice(0, MAX_SECTIONS);
    return { sections: dedupeSections(sections), personalized: hasUsefulAffinity(affinity) };
  },

  async search(
    query: string,
    type: SearchType = 'all',
    _signal?: AbortSignal
  ): Promise<SearchResults> {
    const trimmed = query.trim();
    if (!trimmed) return {};
    const fetchLimit = SEARCH_FETCH_LIMIT;
    const needTracks = type === 'all' || type === 'tracks';
    const [itunesTracks, deezerTracks, itunesArtists, itunesAlbums, itunesPlaylists] =
      await Promise.all([
        needTracks
          ? itunes.searchTracks(trimmed, fetchLimit).catch(() => [] as CanonicalTrack[])
          : Promise.resolve([]),
        needTracks
          ? deezer.searchTracks(trimmed, fetchLimit).catch(() => [] as CanonicalTrack[])
          : Promise.resolve([]),
        type === 'all' || type === 'artists'
          ? itunes.searchArtists(trimmed, fetchLimit).catch(() => [] as CanonicalArtist[])
          : Promise.resolve([]),
        type === 'all' || type === 'albums'
          ? itunes.searchAlbums(trimmed, fetchLimit).catch(() => [] as CanonicalAlbum[])
          : Promise.resolve([]),
        type === 'all' || type === 'playlists'
          ? itunes.searchPlaylists(trimmed, fetchLimit).catch(() => [] as CanonicalPlaylist[])
          : Promise.resolve([]),
      ]);

    const merged = isNonLatin(trimmed)
      ? mergeTrackResults(deezerTracks, itunesTracks)
      : mergeTrackResults(itunesTracks, deezerTracks);

    return {
      tracks: {
        data: merged
          .map((track) => ({ track, score: score(trimmed, track) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 25),
        meta: { page: 1, limit: 25, total: merged.length, totalPages: 1 },
      },
      artists: {
        data: itunesArtists.slice(0, 25),
        meta: { page: 1, limit: 25, total: itunesArtists.length, totalPages: 1 },
      },
      albums: {
        data: itunesAlbums.slice(0, 25),
        meta: { page: 1, limit: 25, total: itunesAlbums.length, totalPages: 1 },
      },
      playlists: {
        data: itunesPlaylists.slice(0, 25),
        meta: { page: 1, limit: 25, total: itunesPlaylists.length, totalPages: 1 },
      },
    };
  },

  async getTrack(id: string): Promise<{ track: CanonicalTrack; sources: PlaybackSource[] }> {
    const track = await lookupTrack(id);
    if (!track) throw new Error(`Track not found: ${id}`);
    return { track, sources: [] };
  },

  async resolvePlayback(id: string): Promise<PlaybackSource> {
    const track = await lookupTrack(id);
    if (!track) throw new Error(`Track not found: ${id}`);
    return musicApi.resolvePlaybackForTrack(track);
  },

  async getAlbum(id: string): Promise<{ album: CanonicalAlbum; tracks: CanonicalTrack[] }> {
    const result = isDeezerId(id)
      ? await deezer.lookupAlbum(stripDeezerPrefix(id))
      : await itunes.lookupAlbum(stripItunesPrefix(id));
    if (!result) throw new Error(`Album not found: ${id}`);
    return result;
  },

  async getArtist(
    id: string
  ): Promise<{ artist: CanonicalArtist; albums: CanonicalAlbum[]; topTracks: CanonicalTrack[] }> {
    const result = isDeezerId(id)
      ? await deezer.lookupArtist(stripDeezerPrefix(id))
      : await itunes.lookupArtist(stripItunesPrefix(id));
    if (!result) throw new Error(`Artist not found: ${id}`);
    return result;
  },

  async getPlaylist(
    id: string
  ): Promise<{ playlist: CanonicalPlaylist; tracks: CanonicalTrack[] }> {
    if (isDeezerId(id)) {
      const result = await deezer.lookupPlaylist(stripDeezerPrefix(id));
      if (!result) throw new Error(`Playlist not found: ${id}`);
      return result;
    }
    // No real iTunes playlist entity: wrap the album (server-compatible).
    const album = await itunes.lookupAlbum(stripItunesPrefix(id));
    if (!album) throw new Error(`Playlist not found: ${id}`);
    return {
      playlist: {
        id: album.album.id,
        name: album.album.title,
        artworkUrl: album.album.artworkUrl,
        owner: { id: 'itunes', name: album.album.artist.name },
        isCollaborative: false,
        trackCount: album.tracks.length,
        providerIds: album.album.providerIds,
        createdAt: '',
        updatedAt: '',
      },
      tracks: album.tracks,
    };
  },

  async getLyrics(id: string, track: CanonicalTrack): Promise<TrackLyrics> {
    return lrclib.getLyrics(id, track);
  },

  /** Resolves a stream for a track we already hold (avoids a lookup hop). */
  async resolvePlaybackForTrack(track: CanonicalTrack): Promise<PlaybackSource> {
    const directUrl =
      typeof track.providerIds.soundcloud === 'string' && track.providerIds.soundcloud.length > 0
        ? track.providerIds.soundcloud
        : typeof track.providerIds.youtube === 'string' && track.providerIds.youtube.length > 0
          ? track.providerIds.youtube
          : null;
    if (directUrl) return resolveStream(directUrl);
    return resolveByQuery(
      track.artists[0]?.name ?? '',
      track.title,
      track.durationMs > 0 ? track.durationMs : null
    );
  },

  /** Direct download sources, in server chain order. */
  async findDownloadSource(
    track: CanonicalTrack
  ): Promise<{ url: string; provider: string; mimeType: string } | null> {
    const archive = await findArchiveSource(track);
    if (archive) return archive;
    if (config.jamendoClientId) {
      const jamendo = await findJamendoSource(track, config.jamendoClientId);
      if (jamendo) return jamendo;
    }
    if (config.fmaApiKey) {
      const fma = await findFmaSource(track, config.fmaApiKey);
      if (fma) return fma;
    }
    return null;
  },
};

/** --- lookup helpers ---------------------------------------------------------- */

async function lookupTrack(id: string): Promise<CanonicalTrack | null> {
  if (isDeezerId(id)) return deezer.lookupTrack(stripDeezerPrefix(id));
  if (id.startsWith('itunes:')) {
    return itunes.lookupTrack(id.slice(7)).catch(() => null);
  }
  return null;
}

/** --- Spotify playlist import (anon; no keys, mirrors server lib/spotify.ts) --- */

const SPOTIFY_UA =
  'Mozilla/5.0 (Linux; Android 13; Sinc) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const BOOTSTRAP_TRACK_ID = '4uLU6hMCjMI75M1A2tKUQC';
const PATHFINDER_SHA = 'a65e12194ed5fc443a1cdebed5fabe33ca5b07b987185d63c72483867ad13cb4';
const MAX_IMPORT_TRACKS = 1000;
const SPOTIFY_API_TIMEOUT_MS = 30_000;

/** Order-agnostic: `id` may appear before/after `type` on the script tag. */
const NEXT_DATA_SCRIPT_RE = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/;

export function extractNextDataScript(html: string): string | null {
  const match = html.match(NEXT_DATA_SCRIPT_RE);
  return match ? match[1] : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const uri = input.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];
  const url = input.match(/open\.spotify\.com\/(?:embed\/)?playlist\/([A-Za-z0-9]{22})/);
  return url?.[1] ?? null;
}

async function bootstrapAnonymousToken(): Promise<string> {
  const html = await providerFetchText(
    `https://open.spotify.com/embed/track/${BOOTSTRAP_TRACK_ID}`,
    { headers: { 'User-Agent': SPOTIFY_UA } },
    SPOTIFY_API_TIMEOUT_MS
  );
  const body = extractNextDataScript(html);
  if (!body) throw new Error('Could not reach Spotify');
  const data: unknown = JSON.parse(body);
  const token = (
    data as {
      props?: { pageProps?: { state?: { settings?: { session?: { accessToken?: unknown } } } } };
    }
  )?.props?.pageProps?.state?.settings?.session?.accessToken;
  if (typeof token !== 'string' || !token) throw new Error('Could not authenticate with Spotify');
  return token;
}

interface SpotifyRawTrack {
  uri: string;
  title: string;
  artists: string[];
  durationMs: number;
}

interface SpotifyPlaylistPage {
  items: SpotifyRawTrack[];
  /** Exact fully-importable count when known (pathfinder); null on the embed fallback. */
  totalCount: number | null;
  name: string;
  owner: string;
  artworkUrl: string | null;
}

async function fetchPlaylistPage(
  playlistId: string,
  token: string,
  offset: number
): Promise<SpotifyPlaylistPage> {
  const url =
    `https://api-partner.spotify.com/pathfinder/v1/query?` +
    `operationName=fetchPlaylist&` +
    `variables=${encodeURIComponent(
      JSON.stringify({
        uri: `spotify:playlist:${playlistId}`,
        offset,
        limit: 100,
        enableWatchFeedEntrypoint: false,
      })
    )}&` +
    `extensions=${encodeURIComponent(
      JSON.stringify({ persistedQuery: { version: 1, sha256Hash: PATHFINDER_SHA } })
    )}`;
  const text = await providerFetchText(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'app-platform': 'WebPlayer',
        Accept: 'application/json',
        'User-Agent': SPOTIFY_UA,
      },
    },
    SPOTIFY_API_TIMEOUT_MS
  );
  const json: unknown = JSON.parse(text);
  const data = (
    json as {
      data?: {
        playlistV2?: {
          name?: unknown;
          ownerV2?: { data?: { name?: unknown } };
          images?: { items?: unknown };
          content?: { totalCount?: unknown; items?: unknown };
        };
      };
    }
  ).data?.playlistV2;

  const content = (data?.content ?? {}) as { totalCount?: unknown; items?: unknown };
  const rawItems = Array.isArray(content.items) ? content.items : [];
  const items: SpotifyRawTrack[] = [];
  for (const raw of rawItems) {
    const trackEl = (raw as { itemV2?: { data?: unknown } })?.itemV2?.data as
      | {
          __typename?: unknown;
          uri?: unknown;
          name?: unknown;
          trackDuration?: unknown;
          artists?: unknown;
        }
      | undefined;
    if (!trackEl || trackEl.__typename !== 'Track') continue;
    const title = typeof trackEl.name === 'string' ? trackEl.name.trim() : '';
    if (!title) continue;
    const duration = (trackEl.trackDuration ?? {}) as { totalMilliseconds?: unknown };
    const artistsNode = (trackEl.artists ?? {}) as { items?: unknown };
    const artistItems = Array.isArray(artistsNode.items) ? artistsNode.items : [];
    const artists = artistItems
      .map((a) => (a as { profile?: { name?: unknown } })?.profile?.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    items.push({
      uri: typeof trackEl.uri === 'string' ? trackEl.uri : '',
      title,
      artists,
      durationMs: typeof duration.totalMilliseconds === 'number' ? duration.totalMilliseconds : 0,
    });
  }

  return {
    items,
    totalCount: typeof content.totalCount === 'number' ? content.totalCount : null,
    name: typeof data?.name === 'string' ? data.name : 'Spotify playlist',
    owner: typeof data?.ownerV2?.data?.name === 'string' ? data.ownerV2.data.name : '',
    artworkUrl: firstCoverUrl((data?.images ?? {})?.items),
  };
}

/** Fallback: parse the public embed page (capped at 100 tracks). */
async function fetchPlaylistFromEmbed(playlistId: string): Promise<SpotifyPlaylistPage> {
  const html = await providerFetchText(
    `https://open.spotify.com/embed/playlist/${playlistId}`,
    { headers: { 'User-Agent': SPOTIFY_UA } },
    SPOTIFY_API_TIMEOUT_MS
  );
  const body = extractNextDataScript(html);
  if (!body) {
    throw new Error(
      'Spotify returned no tracks for this playlist (it may be private or Spotify restricted this link).'
    );
  }
  const json: unknown = JSON.parse(body);
  const entity = (
    json as {
      props?: { pageProps?: { state?: { data?: { entity?: unknown } } } };
    }
  )?.props?.pageProps?.state?.data?.entity as
    { name?: unknown; subtitle?: unknown; coverArt?: unknown; trackList?: unknown } | undefined;

  const trackList = Array.isArray(entity?.trackList) ? entity.trackList : [];
  const items: SpotifyRawTrack[] = [];
  for (const raw of trackList) {
    const item = raw as { uri?: unknown; title?: unknown; subtitle?: unknown; duration?: unknown };
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title) continue;
    const artists =
      typeof item.subtitle === 'string'
        ? item.subtitle
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    items.push({
      uri: typeof item.uri === 'string' ? item.uri : '',
      title,
      artists,
      durationMs: typeof item.duration === 'number' ? item.duration : 0,
    });
  }

  return {
    items,
    totalCount: null,
    name: typeof entity?.name === 'string' ? entity.name : 'Spotify playlist',
    owner: typeof entity?.subtitle === 'string' ? entity.subtitle : '',
    artworkUrl: coverArtUrl(entity?.coverArt),
  };
}

function firstCoverUrl(items: unknown): string | null {
  if (!Array.isArray(items)) return null;
  const first = items[0] as { sources?: unknown } | undefined;
  if (!first) return null;
  if (Array.isArray(first.sources)) {
    const source = first.sources[0] as { url?: unknown } | undefined;
    if (source && typeof source.url === 'string') return source.url;
  }
  return null;
}

function coverArtUrl(coverArt: unknown): string | null {
  if (!coverArt || typeof coverArt !== 'object') return null;
  const art = coverArt as { sources?: unknown[]; uri?: unknown };
  if (Array.isArray(art.sources)) {
    const first = art.sources[0] as { url?: unknown } | undefined;
    if (first && typeof first.url === 'string') return first.url;
  }
  return typeof art.uri === 'string' ? art.uri : null;
}

async function matchOneSpotifyTrack(item: SpotifyRawTrack): Promise<CanonicalTrack> {
  let screen: CanonicalTrack | null = null;
  const query = `${item.artists[0] ?? ''} ${item.title}`;
  try {
    const itunesHits = await itunes.searchTracks(query, 25);
    screen = findBestMatch(item, itunesHits);
  } catch {
    screen = null;
  }
  if (!screen) {
    try {
      const deezerHits = await deezer.searchTracks(query, 25);
      screen = findBestMatch(item, deezerHits);
    } catch {
      screen = null;
    }
  }
  if (!screen) {
    const id = item.uri.split(':').pop() ?? '';
    screen = {
      id: `spotify:${id}`,
      title: item.title,
      artists: item.artists.map((name) => ({
        id: `spotify:${name}`,
        name,
        providerIds: {},
        genres: [],
      })),
      durationMs: item.durationMs,
      providerIds: { spotify: id },
      explicit: false,
    };
  }
  return screen;
}

/**
 * Matches import tracks against the catalog with bounded concurrency instead
 * of one-at-a-time. A 500-track playlist did ~1000 sequential provider calls
 * (minutes of spinner); 8 lanes bring it down to roughly the old 100-track
 * time. Order is preserved so playlist positions survive.
 */
const SPOTIFY_MATCH_CONCURRENCY = 8;

async function matchSpotifyTracks(items: SpotifyRawTrack[]): Promise<CanonicalTrack[]> {
  const out: CanonicalTrack[] = new Array(items.length);
  let next = 0;
  const lanes = Math.min(SPOTIFY_MATCH_CONCURRENCY, items.length);
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        out[index] = await matchOneSpotifyTrack(items[index]);
      }
    })
  );
  return out;
}

function findBestMatch(item: SpotifyRawTrack, candidates: CanonicalTrack[]): CanonicalTrack | null {
  const title = normalizeText(item.title);
  const artist = normalizeText(item.artists[0] ?? '');
  let best: CanonicalTrack | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const t = normalizeText(c.title);
    const a = normalizeText(c.artists[0]?.name ?? '');
    let diff = 0;
    if (t === title) diff += 0;
    else if (t.includes(title) || title.includes(t)) diff += 2;
    else diff += 10;
    if (a === artist) diff += 0;
    else if (a.includes(artist) || artist.includes(a)) diff += 1;
    else diff += 4;
    const durDiff = Math.abs(c.durationMs - item.durationMs) / 1000;
    if (durDiff < 3) diff += 0;
    else if (durDiff < 10) diff += 1;
    else diff += 3;
    if (diff < bestScore) {
      bestScore = diff;
      best = c;
    }
  }
  return best && bestScore <= 5 ? best : null;
}

export async function importSpotifyPlaylist(url: string): Promise<SpotifyImportResult> {
  const playlistId = parsePlaylistId(url);
  if (!playlistId) throw new Error('Not a valid Spotify playlist link');

  const items: SpotifyRawTrack[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  const feedItems = (raw: SpotifyRawTrack[]): number => {
    let skipped = 0;
    for (const item of raw) {
      const key = `${normalizeText(item.title)}|${normalizeText(item.artists[0] ?? '')}`;
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
      items.push(item);
    }
    return skipped;
  };

  let metadata: {
    name: string;
    owner: string;
    artworkUrl: string | null;
    totalCount: number | null;
  };
  let embedFallback = false;

  try {
    // The token has no in-flight dedupe here; a failure re-bootstraps once
    // before giving up, then the whole pathfinder path degrades to the embed.
    let token = '';
    try {
      token = await bootstrapAnonymousToken();
    } catch {
      await delay(200);
      token = await bootstrapAnonymousToken();
    }
    const first = await fetchPlaylistPage(playlistId, token, 0);
    metadata = {
      name: first.name,
      owner: first.owner,
      artworkUrl: first.artworkUrl,
      totalCount: first.totalCount,
    };
    duplicates += feedItems(first.items);
    for (let offset = 100; offset < MAX_IMPORT_TRACKS; offset += 100) {
      if (metadata.totalCount !== null && items.length >= metadata.totalCount) break;
      const page = await fetchPlaylistPage(playlistId, token, offset);
      if (page.totalCount !== null) metadata.totalCount = page.totalCount;
      metadata.name = page.name || metadata.name;
      metadata.owner = page.owner || metadata.owner;
      metadata.artworkUrl = page.artworkUrl || metadata.artworkUrl;
      duplicates += feedItems(page.items);
      if (page.items.length < 100) break;
    }
  } catch (e) {
    console.warn('Spotify pathfinder failed, falling back to embed:', e);
    const fromEmbed = await fetchPlaylistFromEmbed(playlistId);
    items.length = 0;
    seen.clear();
    duplicates = 0;
    feedItems(fromEmbed.items);
    metadata = {
      name: fromEmbed.name,
      owner: fromEmbed.owner,
      artworkUrl: fromEmbed.artworkUrl,
      totalCount: fromEmbed.totalCount,
    };
    embedFallback = true;
  }

  if (items.length === 0) {
    throw new Error(
      'Spotify returned no tracks for this playlist (it may be private or Spotify restricted this link).'
    );
  }

  const tracks = await matchSpotifyTracks(items);
  return {
    playlist: {
      id: `spotify:playlist:${playlistId}`,
      name: metadata.name || 'Imported from Spotify',
      owner: metadata.owner || 'Spotify',
      artworkUrl: metadata.artworkUrl,
      totalCount: metadata.totalCount ?? items.length,
      truncated: items.length >= MAX_IMPORT_TRACKS || (embedFallback && items.length >= 100),
    },
    tracks,
    counts: {
      fetched: items.length,
      matched: tracks.filter((t) => !t.id.startsWith('spotify:')).length,
      unresolved: tracks.filter((t) => t.id.startsWith('spotify:')).length,
      duplicates,
    },
  };
}
