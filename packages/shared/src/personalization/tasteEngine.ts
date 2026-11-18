/**
 * Sinc Deterministic User Taste Profile Derivation Engine
 *
 * Implements pure, deterministic calculation of a user's musical taste profile:
 * - Aggregates discrete listening events and explicit user interactions (likes, follows, saves).
 * - Applies dual-horizon exponential decay: short-term (7 days) and long-term (45 days).
 * - Separates qualified plays, full completions, replays, and early skips.
 * - Extracts top artists, top genres, frequently played, recently played, and on-repeat tracks.
 * - Guarantees 100% deterministic recalculation from raw event history.
 * - Provides clean cold-start behavior without fabricating preferences.
 */

import type {
  CanonicalAlbum,
  CanonicalArtist,
  CanonicalTrack,
  DiscoveryMode,
  ListeningEvent,
  MusicTasteProfile,
  TasteScore,
} from '../types/index.js';

export const TASTE_SIGNAL_WEIGHTS = {
  EXPLICIT_LIKE: 2.5,
  ARTIST_FOLLOW: 2.0,
  ALBUM_SAVE: 1.5,
  PLAYLIST_SAVE: 1.5,
  QUALIFIED_PLAY: 1.0,
  FULL_COMPLETION: 1.5,
  REPLAY: 1.8,
  DOWNLOAD: 1.2,
  EARLY_SKIP: -0.3,
  REPEATED_SKIP: -1.0,
  DISLIKE: -3.0,
} as const;

export const DECAY_HALF_LIFE_SHORT_DAYS = 7;
export const DECAY_HALF_LIFE_LONG_DAYS = 45;
export const REPEATED_SKIP_THRESHOLD = 2;

export interface TasteEngineInput {
  userId?: string;
  events: ListeningEvent[];
  favoriteTracks?: CanonicalTrack[];
  followedArtists?: CanonicalArtist[];
  followedAlbums?: CanonicalAlbum[];
  downloadedTracks?: CanonicalTrack[];
  discoveryMode?: DiscoveryMode;
  discoveryPreference?: number;
  personalizationEnabled?: boolean;
  nowMs?: number;
}

interface EntityAccumulator {
  id: string;
  name: string;
  shortTermScore: number;
  longTermScore: number;
  playCount: number;
  qualifiedCount: number;
  completionCount: number;
  skipCount: number;
  lastPlayedAt: number;
}

function calculateDecay(timestamp: number, nowMs: number, halfLifeDays: number): number {
  if (!timestamp || timestamp > nowMs) return 1.0;
  const ageDays = (nowMs - timestamp) / (24 * 60 * 60 * 1000);
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

function getOrInit(map: Map<string, EntityAccumulator>, key: string, name: string): EntityAccumulator {
  const norm = key.trim().toLowerCase();
  let item = map.get(norm);
  if (!item) {
    item = {
      id: key,
      name: name.trim() || key,
      shortTermScore: 0,
      longTermScore: 0,
      playCount: 0,
      qualifiedCount: 0,
      completionCount: 0,
      skipCount: 0,
      lastPlayedAt: 0,
    };
    map.set(norm, item);
  }
  return item;
}

export function computeUserTasteProfile(input: TasteEngineInput): MusicTasteProfile {
  const nowMs = input.nowMs ?? Date.now();
  const enabled = input.personalizationEnabled ?? true;
  const discoveryPreference = input.discoveryPreference ?? 0.5;
  const discoveryMode =
    input.discoveryMode ??
    (discoveryPreference <= 0.33 ? 'familiar' : discoveryPreference >= 0.67 ? 'exploration' : 'balanced');

  const emptyProfile: MusicTasteProfile = {
    topArtists: [],
    topGenres: [],
    topAlbums: [],
    favoriteGenres: [],
    favoriteArtists: [],
    frequentlyPlayedTracks: [],
    recentlyPlayedTracks: [],
    repeatedlyPlayedTracks: [],
    skippedTracks: [],
    discoveryMode,
    discoveryPreference,
    personalizationEnabled: enabled,
    totalListeningTimeMs: 0,
    totalQualifiedPlays: 0,
    totalCompletions: 0,
    totalSkips: 0,
    isEmpty: true,
    lastUpdated: nowMs,
  };

  if (!enabled) {
    return emptyProfile;
  }

  const events = input.events ?? [];
  const favoriteTracks = input.favoriteTracks ?? [];
  const followedArtists = input.followedArtists ?? [];
  const followedAlbums = input.followedAlbums ?? [];
  const downloadedTracks = input.downloadedTracks ?? [];

  const hasAnyActivity =
    events.length > 0 ||
    favoriteTracks.length > 0 ||
    followedArtists.length > 0 ||
    followedAlbums.length > 0 ||
    downloadedTracks.length > 0;

  if (!hasAnyActivity) {
    return emptyProfile;
  }

  const artistMap = new Map<string, EntityAccumulator>();
  const genreMap = new Map<string, EntityAccumulator>();
  const albumMap = new Map<string, EntityAccumulator>();

  const trackStats = new Map<
    string,
    {
      title: string;
      artistName: string;
      playCount: number;
      qualifiedCount: number;
      completionCount: number;
      skipCount: number;
      lastPlayedAt: number;
    }
  >();

  let totalListeningTimeMs = 0;
  let totalQualifiedPlays = 0;
  let totalCompletions = 0;
  let totalSkips = 0;

  // 1. Process explicit user library preferences
  for (const artist of followedArtists) {
    if (!artist.name?.trim()) continue;
    const a = getOrInit(artistMap, artist.id || artist.name, artist.name);
    a.shortTermScore += TASTE_SIGNAL_WEIGHTS.ARTIST_FOLLOW * 0.5;
    a.longTermScore += TASTE_SIGNAL_WEIGHTS.ARTIST_FOLLOW * 1.5;
    for (const g of artist.genres ?? []) {
      if (!g?.trim()) continue;
      const gen = getOrInit(genreMap, g, g);
      gen.shortTermScore += 0.5;
      gen.longTermScore += 1.0;
    }
  }

  for (const album of followedAlbums) {
    if (album.title?.trim()) {
      const alb = getOrInit(albumMap, album.id || album.title, album.title);
      alb.shortTermScore += TASTE_SIGNAL_WEIGHTS.ALBUM_SAVE * 0.5;
      alb.longTermScore += TASTE_SIGNAL_WEIGHTS.ALBUM_SAVE * 1.5;
    }
    if (album.artist?.name?.trim()) {
      const a = getOrInit(artistMap, album.artist.id || album.artist.name, album.artist.name);
      a.shortTermScore += 0.3;
      a.longTermScore += 0.8;
    }
  }

  for (const track of favoriteTracks) {
    const leadArtist = track.artists[0]?.name;
    if (leadArtist?.trim()) {
      const a = getOrInit(artistMap, track.artists[0]?.id || leadArtist, leadArtist);
      a.shortTermScore += TASTE_SIGNAL_WEIGHTS.EXPLICIT_LIKE * 0.4;
      a.longTermScore += TASTE_SIGNAL_WEIGHTS.EXPLICIT_LIKE * 1.2;
    }
    if (track.album?.title?.trim()) {
      const alb = getOrInit(albumMap, track.album.id || track.album.title, track.album.title);
      alb.shortTermScore += 0.3;
      alb.longTermScore += 0.8;
    }
    for (const g of track.artists[0]?.genres ?? []) {
      if (!g?.trim()) continue;
      const gen = getOrInit(genreMap, g, g);
      gen.shortTermScore += 0.3;
      gen.longTermScore += 0.8;
    }
  }

  for (const track of downloadedTracks) {
    const leadArtist = track.artists[0]?.name;
    if (leadArtist?.trim()) {
      const a = getOrInit(artistMap, track.artists[0]?.id || leadArtist, leadArtist);
      a.shortTermScore += TASTE_SIGNAL_WEIGHTS.DOWNLOAD * 0.3;
      a.longTermScore += TASTE_SIGNAL_WEIGHTS.DOWNLOAD * 1.0;
    }
  }

  // 2. Process discrete listening events in chronological sequence
  for (const ev of events) {
    totalListeningTimeMs += ev.playbackDurationMs || 0;
    const stDecay = calculateDecay(ev.timestamp, nowMs, DECAY_HALF_LIFE_SHORT_DAYS);
    const ltDecay = calculateDecay(ev.timestamp, nowMs, DECAY_HALF_LIFE_LONG_DAYS);

    // Track level stats
    if (ev.trackId) {
      let tStat = trackStats.get(ev.trackId);
      if (!tStat) {
        tStat = {
          title: ev.trackTitle ?? 'Unknown Track',
          artistName: ev.artistName ?? 'Unknown Artist',
          playCount: 0,
          qualifiedCount: 0,
          completionCount: 0,
          skipCount: 0,
          lastPlayedAt: 0,
        };
        trackStats.set(ev.trackId, tStat);
      }
      if (ev.timestamp > tStat.lastPlayedAt) {
        tStat.lastPlayedAt = ev.timestamp;
      }

      switch (ev.eventType) {
        case 'track_started':
          tStat.playCount += 1;
          break;
        case 'track_completed':
          tStat.completionCount += 1;
          totalCompletions += 1;
          break;
        case 'track_replayed':
          tStat.playCount += 1;
          break;
        case 'track_skipped':
          tStat.skipCount += 1;
          totalSkips += 1;
          break;
      }

      if (ev.meaningfulPlayQualified) {
        tStat.qualifiedCount += 1;
        totalQualifiedPlays += 1;
      }
    }

    // Artist level stats
    if (ev.artistName?.trim()) {
      const a = getOrInit(artistMap, ev.artistId || ev.artistName, ev.artistName);
      if (ev.timestamp > a.lastPlayedAt) {
        a.lastPlayedAt = ev.timestamp;
      }

      switch (ev.eventType) {
        case 'track_started':
          a.playCount += 1;
          break;
        case 'playback_progress':
          if (ev.meaningfulPlayQualified) {
            a.qualifiedCount += 1;
            a.shortTermScore += TASTE_SIGNAL_WEIGHTS.QUALIFIED_PLAY * stDecay;
            a.longTermScore += TASTE_SIGNAL_WEIGHTS.QUALIFIED_PLAY * ltDecay;
          }
          break;
        case 'track_completed':
          a.completionCount += 1;
          a.shortTermScore += TASTE_SIGNAL_WEIGHTS.FULL_COMPLETION * stDecay;
          a.longTermScore += TASTE_SIGNAL_WEIGHTS.FULL_COMPLETION * ltDecay;
          break;
        case 'track_replayed':
          a.playCount += 1;
          a.shortTermScore += TASTE_SIGNAL_WEIGHTS.REPLAY * stDecay;
          a.longTermScore += TASTE_SIGNAL_WEIGHTS.REPLAY * ltDecay;
          break;
        case 'track_skipped': {
          a.skipCount += 1;
          const penalty =
            a.skipCount >= REPEATED_SKIP_THRESHOLD
              ? TASTE_SIGNAL_WEIGHTS.REPEATED_SKIP
              : TASTE_SIGNAL_WEIGHTS.EARLY_SKIP;
          a.shortTermScore += penalty * stDecay;
          a.longTermScore += penalty * ltDecay * 0.5;
          break;
        }
        case 'track_liked':
          a.shortTermScore += TASTE_SIGNAL_WEIGHTS.EXPLICIT_LIKE * stDecay;
          a.longTermScore += TASTE_SIGNAL_WEIGHTS.EXPLICIT_LIKE * ltDecay;
          break;
        case 'track_unliked':
          a.shortTermScore -= TASTE_SIGNAL_WEIGHTS.EXPLICIT_LIKE * stDecay * 0.5;
          break;
        case 'artist_followed':
          a.shortTermScore += TASTE_SIGNAL_WEIGHTS.ARTIST_FOLLOW * stDecay;
          a.longTermScore += TASTE_SIGNAL_WEIGHTS.ARTIST_FOLLOW * ltDecay;
          break;
        case 'artist_unfollowed':
          a.shortTermScore -= TASTE_SIGNAL_WEIGHTS.ARTIST_FOLLOW * stDecay * 0.5;
          break;
      }
    }

    // Album level stats
    if (ev.albumTitle?.trim()) {
      const alb = getOrInit(albumMap, ev.albumId || ev.albumTitle, ev.albumTitle);
      if (ev.timestamp > alb.lastPlayedAt) alb.lastPlayedAt = ev.timestamp;
      if (ev.eventType === 'track_completed') {
        alb.completionCount += 1;
        alb.shortTermScore += TASTE_SIGNAL_WEIGHTS.FULL_COMPLETION * stDecay * 0.6;
        alb.longTermScore += TASTE_SIGNAL_WEIGHTS.FULL_COMPLETION * ltDecay * 0.6;
      }
    }

    // Genre level stats
    if (ev.genres && ev.genres.length > 0) {
      for (const g of ev.genres) {
        if (!g?.trim()) continue;
        const gen = getOrInit(genreMap, g, g);
        if (ev.timestamp > gen.lastPlayedAt) gen.lastPlayedAt = ev.timestamp;
        let delta = 0;
        if (ev.eventType === 'track_completed') {
          delta = 1.0;
        } else if (ev.meaningfulPlayQualified) {
          delta = 0.6;
        } else if (ev.eventType === 'track_liked') {
          delta = 1.5;
        } else if (ev.eventType === 'track_skipped') {
          delta = -0.3;
        }

        if (delta !== 0) {
          gen.shortTermScore += delta * stDecay;
          gen.longTermScore += delta * ltDecay;
        }
      }
    }
  }

  // 3. Compile ranked TasteScore lists
  const alpha = discoveryMode === 'exploration' ? 0.8 : discoveryMode === 'familiar' ? 0.35 : 0.65;

  const compileTasteList = (map: Map<string, EntityAccumulator>): TasteScore[] => {
    return Array.from(map.values())
      .map((item) => {
        const composite = alpha * item.shortTermScore + (1 - alpha) * item.longTermScore;
        return {
          id: item.id,
          name: item.name,
          score: Math.max(0, Math.round(composite * 100) / 100),
          shortTermScore: Math.round(item.shortTermScore * 100) / 100,
          longTermScore: Math.round(item.longTermScore * 100) / 100,
          playCount: item.playCount,
          completionCount: item.completionCount,
          skipCount: item.skipCount,
          lastPlayedAt: item.lastPlayedAt,
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.playCount - a.playCount);
  };

  const topArtists = compileTasteList(artistMap).slice(0, 50);
  const topGenres = compileTasteList(genreMap).slice(0, 30);
  const topAlbums = compileTasteList(albumMap).slice(0, 30);

  const favoriteArtists = topArtists.slice(0, 10).map((a) => a.name);
  const favoriteGenres = topGenres.slice(0, 5).map((g) => g.name);

  // 4. Compile track-level activity slices
  const trackEntries = Array.from(trackStats.entries());

  const frequentlyPlayedTracks = trackEntries
    .filter(([, stat]) => stat.qualifiedCount > 0 || stat.playCount > 1)
    .sort((a, b) => b[1].qualifiedCount - a[1].qualifiedCount || b[1].playCount - a[1].playCount)
    .slice(0, 25)
    .map(([trackId, s]) => ({
      trackId,
      title: s.title,
      artistName: s.artistName,
      count: s.qualifiedCount || s.playCount,
    }));

  const recentlyPlayedTracks = trackEntries
    .filter(([, stat]) => stat.lastPlayedAt > 0)
    .sort((a, b) => b[1].lastPlayedAt - a[1].lastPlayedAt)
    .slice(0, 25)
    .map(([trackId, s]) => ({
      trackId,
      title: s.title,
      artistName: s.artistName,
      lastPlayedAt: s.lastPlayedAt,
    }));

  const repeatedlyPlayedTracks = trackEntries
    .filter(([, stat]) => stat.playCount >= 2)
    .sort((a, b) => b[1].playCount - a[1].playCount)
    .slice(0, 25)
    .map(([trackId, s]) => ({
      trackId,
      title: s.title,
      artistName: s.artistName,
      count: s.playCount,
    }));

  const skippedTracks = trackEntries
    .filter(([, stat]) => stat.skipCount > 0)
    .sort((a, b) => b[1].skipCount - a[1].skipCount)
    .slice(0, 25)
    .map(([trackId, s]) => ({
      trackId,
      title: s.title,
      artistName: s.artistName,
      count: s.skipCount,
    }));

  return {
    topArtists,
    topGenres,
    topAlbums,
    favoriteGenres,
    favoriteArtists,
    frequentlyPlayedTracks,
    recentlyPlayedTracks,
    repeatedlyPlayedTracks,
    skippedTracks,
    discoveryMode,
    discoveryPreference,
    personalizationEnabled: true,
    totalListeningTimeMs,
    totalQualifiedPlays,
    totalCompletions,
    totalSkips,
    isEmpty: topArtists.length === 0 && topGenres.length === 0 && favoriteArtists.length === 0,
    lastUpdated: nowMs,
  };
}
