import type {
  CanonicalAlbum,
  CanonicalArtist,
  CanonicalTrack,
  DiscoveryMode,
  ListeningEvent,
  ListeningInsights,
  ListeningTimeRange,
  MusicTasteProfile,
  TasteScore,
} from '@sinc/shared';
import type { PlayStat } from '../library/libraryStore';

export const TASTE_WEIGHTS = {
  EXPLICIT_LIKE: 2.5,
  ARTIST_FOLLOW: 2.0,
  ALBUM_FOLLOW: 1.5,
  PLAYLIST_ADD: 1.5,
  FULL_COMPLETION: 1.2,
  PLAY_STARTED: 0.7,
  REPLAY: 1.0,
  DOWNLOAD: 1.0,
  SEARCH_INTERACTION: 0.3,
  EARLY_SKIP: -0.3,
  REPEATED_SKIP: -1.0,
  THUMB_DOWN: -2.5,
} as const;

export const SHORT_TERM_HALF_LIFE_DAYS = 7;
export const LONG_TERM_HALF_LIFE_DAYS = 60;
export const SKIP_THRESHOLD_FOR_PENALTY = 2;
export const SKIP_THRESHOLD_FOR_BLACKLIST = 3;

export function mapDiscoveryMode(pref: number): DiscoveryMode {
  if (pref <= 0.33) return 'familiar';
  if (pref >= 0.67) return 'exploration';
  return 'balanced';
}

export function discoveryPreferenceForMode(mode: DiscoveryMode): number {
  switch (mode) {
    case 'familiar':
      return 0.15;
    case 'exploration':
      return 0.85;
    case 'balanced':
    default:
      return 0.5;
  }
}

function recencyDecay(timestamp: number, nowMs: number, halfLifeDays: number): number {
  if (!timestamp || timestamp > nowMs) return 1.0;
  const ageDays = (nowMs - timestamp) / (24 * 60 * 60 * 1000);
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

export interface TasteProfileInput {
  events: ListeningEvent[];
  playStats: Record<string, PlayStat>;
  skipStats: Record<string, number>;
  artistPlayStats: Record<string, number>;
  favoriteTracks: CanonicalTrack[];
  followedArtists: CanonicalArtist[];
  followedAlbums: CanonicalAlbum[];
  downloadedTracks: CanonicalTrack[];
  thumbsUp?: Record<string, number>;
  thumbsDown?: Record<string, number>;
  hiddenTrackIds?: string[];
  hiddenArtistNames?: string[];
  initialFavoriteGenres?: string[];
  initialFavoriteArtists?: string[];
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
  completionCount: number;
  skipCount: number;
  lastPlayedAt: number;
}

function getOrInit(map: Map<string, EntityAccumulator>, key: string, name: string): EntityAccumulator {
  const normKey = key.trim().toLowerCase();
  let existing = map.get(normKey);
  if (!existing) {
    existing = {
      id: key,
      name: name.trim() || key,
      shortTermScore: 0,
      longTermScore: 0,
      playCount: 0,
      completionCount: 0,
      skipCount: 0,
      lastPlayedAt: 0,
    };
    map.set(normKey, existing);
  }
  return existing;
}

export function computeTasteProfile(input: TasteProfileInput): MusicTasteProfile {
  const nowMs = input.nowMs ?? Date.now();
  const enabled = input.personalizationEnabled ?? true;
  const discoveryMode = input.discoveryMode ?? mapDiscoveryMode(input.discoveryPreference ?? 0.5);
  const discoveryPreference =
    input.discoveryPreference ?? discoveryPreferenceForMode(discoveryMode);

  if (!enabled) {
    return {
      topArtists: [],
      topGenres: [],
      topAlbums: [],
      favoriteGenres: [],
      favoriteArtists: [],
      discoveryMode,
      discoveryPreference,
      personalizationEnabled: false,
      totalListeningTimeMs: 0,
      lastUpdated: nowMs,
    };
  }

  const artistMap = new Map<string, EntityAccumulator>();
  const genreMap = new Map<string, EntityAccumulator>();
  const albumMap = new Map<string, EntityAccumulator>();
  const hiddenArtistsLower = new Set(
    (input.hiddenArtistNames ?? []).map((name) => name.trim().toLowerCase())
  );
  const thumbsDownIds = new Set(Object.keys(input.thumbsDown ?? {}));

  // 1. Initial cold-start seed signals
  for (const artName of input.initialFavoriteArtists ?? []) {
    if (!artName.trim()) continue;
    const a = getOrInit(artistMap, artName, artName);
    a.shortTermScore += TASTE_WEIGHTS.ARTIST_FOLLOW * 1.0;
    a.longTermScore += TASTE_WEIGHTS.ARTIST_FOLLOW * 1.5;
  }
  for (const genre of input.initialFavoriteGenres ?? []) {
    if (!genre.trim()) continue;
    const g = getOrInit(genreMap, genre, genre);
    g.shortTermScore += TASTE_WEIGHTS.ARTIST_FOLLOW * 1.0;
    g.longTermScore += TASTE_WEIGHTS.ARTIST_FOLLOW * 1.5;
  }

  // 2. Explicit follows and favorites
  for (const artist of input.followedArtists) {
    if (!artist.name.trim()) continue;
    const a = getOrInit(artistMap, artist.name, artist.name);
    a.shortTermScore += TASTE_WEIGHTS.ARTIST_FOLLOW * 0.2;
    a.longTermScore += TASTE_WEIGHTS.ARTIST_FOLLOW * 1.5;
    for (const g of artist.genres ?? []) {
      if (g.trim()) {
        const item = getOrInit(genreMap, g, g);
        item.shortTermScore += 0.2;
        item.longTermScore += 1.0;
      }
    }
  }

  for (const album of input.followedAlbums) {
    if (album.title.trim()) {
      const alb = getOrInit(albumMap, album.title, album.title);
      alb.shortTermScore += TASTE_WEIGHTS.ALBUM_FOLLOW * 0.2;
      alb.longTermScore += TASTE_WEIGHTS.ALBUM_FOLLOW * 1.5;
    }
    if (album.artist?.name.trim()) {
      const a = getOrInit(artistMap, album.artist.name, album.artist.name);
      a.shortTermScore += 0.2;
      a.longTermScore += 1.0;
    }
  }

  for (const track of input.favoriteTracks) {
    const leadArtist = track.artists[0]?.name;
    if (leadArtist?.trim()) {
      const a = getOrInit(artistMap, leadArtist, leadArtist);
      a.shortTermScore += TASTE_WEIGHTS.EXPLICIT_LIKE * 0.2;
      a.longTermScore += TASTE_WEIGHTS.EXPLICIT_LIKE * 1.5;
    }
    if (track.album?.title?.trim()) {
      const alb = getOrInit(albumMap, track.album.title, track.album.title);
      alb.shortTermScore += 0.2;
      alb.longTermScore += 1.0;
    }
  }

  for (const track of input.downloadedTracks) {
    const leadArtist = track.artists[0]?.name;
    if (leadArtist?.trim()) {
      const a = getOrInit(artistMap, leadArtist, leadArtist);
      a.shortTermScore += TASTE_WEIGHTS.DOWNLOAD * 0.2;
      a.longTermScore += TASTE_WEIGHTS.DOWNLOAD * 1.0;
    }
  }

  // 3. Aggregate play counts and skip stats
  for (const [artistName, count] of Object.entries(input.artistPlayStats)) {
    if (!artistName.trim()) continue;
    const a = getOrInit(artistMap, artistName, artistName);
    a.playCount += count;
  }

  // 4. Process rich listening events
  let totalListeningTimeMs = 0;
  for (const ev of input.events) {
    totalListeningTimeMs += ev.playbackDurationMs || 0;
    const stDecay = recencyDecay(ev.timestamp, nowMs, SHORT_TERM_HALF_LIFE_DAYS);
    const ltDecay = recencyDecay(ev.timestamp, nowMs, LONG_TERM_HALF_LIFE_DAYS);

    if (ev.artistName?.trim()) {
      const a = getOrInit(artistMap, ev.artistName, ev.artistName);
      if (ev.timestamp > a.lastPlayedAt) a.lastPlayedAt = ev.timestamp;

      switch (ev.eventType) {
        case 'track_completed':
          a.completionCount += 1;
          a.shortTermScore += TASTE_WEIGHTS.FULL_COMPLETION * stDecay;
          a.longTermScore += TASTE_WEIGHTS.FULL_COMPLETION * ltDecay;
          break;
        case 'track_started':
          a.playCount += 1;
          a.shortTermScore += TASTE_WEIGHTS.PLAY_STARTED * stDecay;
          a.longTermScore += TASTE_WEIGHTS.PLAY_STARTED * ltDecay;
          break;
        case 'track_replayed':
          a.playCount += 1;
          a.shortTermScore += TASTE_WEIGHTS.REPLAY * stDecay;
          a.longTermScore += TASTE_WEIGHTS.REPLAY * ltDecay;
          break;
        case 'track_skipped':
          a.skipCount += 1;
          // Rule 13: Never treat a single skip as proof of dislike.
          // Mild penalty for early skips, and repeated skips apply full penalty.
          const skipPenalty =
            a.skipCount >= SKIP_THRESHOLD_FOR_PENALTY
              ? TASTE_WEIGHTS.REPEATED_SKIP
              : TASTE_WEIGHTS.EARLY_SKIP;
          a.shortTermScore += skipPenalty * stDecay;
          a.longTermScore += skipPenalty * ltDecay * 0.5;
          break;
        case 'track_liked':
          a.shortTermScore += TASTE_WEIGHTS.EXPLICIT_LIKE * stDecay;
          a.longTermScore += TASTE_WEIGHTS.EXPLICIT_LIKE * ltDecay;
          break;
        case 'playlist_add':
          a.shortTermScore += TASTE_WEIGHTS.PLAYLIST_ADD * stDecay;
          a.longTermScore += TASTE_WEIGHTS.PLAYLIST_ADD * ltDecay;
          break;
        default:
          break;
      }
    }

    if (ev.albumTitle?.trim()) {
      const alb = getOrInit(albumMap, ev.albumTitle, ev.albumTitle);
      if (ev.timestamp > alb.lastPlayedAt) alb.lastPlayedAt = ev.timestamp;
      if (ev.eventType === 'track_completed' || ev.eventType === 'album_played') {
        alb.completionCount += 1;
        alb.shortTermScore += TASTE_WEIGHTS.FULL_COMPLETION * stDecay * 0.7;
        alb.longTermScore += TASTE_WEIGHTS.FULL_COMPLETION * ltDecay * 0.7;
      }
    }

    if (ev.genres) {
      for (const g of ev.genres) {
        if (!g.trim()) continue;
        const gen = getOrInit(genreMap, g, g);
        if (ev.timestamp > gen.lastPlayedAt) gen.lastPlayedAt = ev.timestamp;
        const delta = ev.eventType === 'track_completed' ? 1.0 : 0.5;
        gen.shortTermScore += delta * stDecay;
        gen.longTermScore += delta * ltDecay;
      }
    }
  }

  // 5. Thumbs down penalty
  for (const trackId of thumbsDownIds) {
    const track =
      input.favoriteTracks.find((t) => t.id === trackId) ??
      input.downloadedTracks.find((t) => t.id === trackId);
    if (track?.artists[0]?.name) {
      const a = getOrInit(artistMap, track.artists[0].name, track.artists[0].name);
      a.shortTermScore += TASTE_WEIGHTS.THUMB_DOWN;
      a.longTermScore += TASTE_WEIGHTS.THUMB_DOWN;
    }
  }

  // Helper to compile and rank entities
  const compileList = (
    map: Map<string, EntityAccumulator>,
    filterFn?: (item: EntityAccumulator) => boolean
  ): TasteScore[] => {
    const list: TasteScore[] = [];
    for (const item of map.values()) {
      if (filterFn && !filterFn(item)) continue;
      // Combined balanced score: 55% short-term + 45% long-term
      const combined = Math.max(0, item.shortTermScore * 0.55 + item.longTermScore * 0.45);
      const score = Math.log1p(combined);
      list.push({
        id: item.id,
        name: item.name,
        score,
        shortTermScore: Math.max(0, item.shortTermScore),
        longTermScore: Math.max(0, item.longTermScore),
        playCount: item.playCount,
        completionCount: item.completionCount,
        skipCount: item.skipCount,
        lastPlayedAt: item.lastPlayedAt,
      });
    }
    return list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  };

  const topArtists = compileList(artistMap, (a) => !hiddenArtistsLower.has(a.name.toLowerCase()));
  const topGenres = compileList(genreMap);
  const topAlbums = compileList(albumMap);

  const favoriteArtists = topArtists
    .filter((a) => a.score > 0.3)
    .slice(0, 15)
    .map((a) => a.name);

  const favoriteGenres = topGenres
    .filter((g) => g.score > 0.2)
    .slice(0, 8)
    .map((g) => g.name);

  return {
    topArtists,
    topGenres,
    topAlbums,
    favoriteGenres,
    favoriteArtists,
    discoveryMode,
    discoveryPreference,
    personalizationEnabled: true,
    totalListeningTimeMs,
    lastUpdated: nowMs,
  };
}

export function computeListeningInsights(
  events: ListeningEvent[],
  playStats: Record<string, PlayStat>,
  range: ListeningTimeRange,
  nowMs = Date.now()
): ListeningInsights {
  const windowDays = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : Infinity;
  const cutoffMs = windowDays === Infinity ? 0 : nowMs - windowDays * 24 * 60 * 60 * 1000;

  const inWindowEvents = events.filter((e) => e.timestamp >= cutoffMs);
  let totalDurationMs = 0;
  let totalPlays = 0;
  let completions = 0;

  const artistMinutes = new Map<string, { minutes: number; playCount: number }>();
  const genreMinutes = new Map<string, { minutes: number; playCount: number }>();
  const trackPlays = new Map<string, { title: string; artistName: string; playCount: number }>();
  const artistFirstSeen = new Map<string, number>();

  for (const ev of inWindowEvents) {
    // Only accumulate duration on terminal playback events (completed, skipped)
    // or if a started track didn't emit a terminal event, to avoid double-counting.
    const isTerminal = ev.eventType === 'track_completed' || ev.eventType === 'track_skipped';
    const durMs = isTerminal ? ev.playbackDurationMs || 0 : 0;
    totalDurationMs += durMs;
    const durMin = durMs / 60000;

    if (ev.eventType === 'track_started' || ev.eventType === 'track_replayed') {
      totalPlays += 1;
    } else if (ev.eventType === 'track_completed') {
      completions += 1;
    }

    if (ev.artistName?.trim()) {
      const art = ev.artistName.trim();
      const current = artistMinutes.get(art) ?? { minutes: 0, playCount: 0 };
      current.minutes += durMin;
      if (ev.eventType === 'track_started' || ev.eventType === 'track_completed') {
        current.playCount += 1;
      }
      artistMinutes.set(art, current);

      const firstSeen = artistFirstSeen.get(art);
      if (firstSeen === undefined || ev.timestamp < firstSeen) {
        artistFirstSeen.set(art, ev.timestamp);
      }
    }

    if (ev.genres) {
      for (const g of ev.genres) {
        const gen = g.trim();
        if (!gen) continue;
        const current = genreMinutes.get(gen) ?? { minutes: 0, playCount: 0 };
        current.minutes += durMin;
        if (ev.eventType === 'track_started' || ev.eventType === 'track_completed') {
          current.playCount += 1;
        }
        genreMinutes.set(gen, current);
      }
    }

    if (ev.trackId) {
      const t = trackPlays.get(ev.trackId) ?? {
        title: ev.trackTitle ?? 'Track',
        artistName: ev.artistName ?? 'Unknown Artist',
        playCount: 0,
      };
      if (ev.eventType === 'track_started' || ev.eventType === 'track_completed') {
        t.playCount += 1;
      }
      trackPlays.set(ev.trackId, t);
    }
  }

  // If few/no rich events exist yet (e.g. legacy listening before event tracking),
  // supplement play count and estimated minutes from playStats safely without fabricating fake numbers.
  if (inWindowEvents.length === 0 && range === 'all') {
    for (const [trackId, stat] of Object.entries(playStats)) {
      if (stat.lastPlayedAt >= cutoffMs) {
        totalPlays += stat.count;
        completions += stat.completedCount;
      }
    }
    // Estimated ~3.5 min per recorded play only if positive
    totalDurationMs = totalPlays * 3.5 * 60 * 1000;
  }

  const totalMinutes = Math.round(totalDurationMs / 60000);
  const completionRate = totalPlays > 0 ? Math.min(1, completions / totalPlays) : 0;

  const topArtists = [...artistMinutes.entries()]
    .map(([name, data]) => ({
      name,
      minutes: Math.round(data.minutes),
      playCount: data.playCount,
    }))
    .sort((a, b) => b.minutes - a.minutes || b.playCount - a.playCount)
    .slice(0, 10);

  const topGenres = [...genreMinutes.entries()]
    .map(([name, data]) => ({
      name,
      minutes: Math.round(data.minutes),
      playCount: data.playCount,
    }))
    .sort((a, b) => b.minutes - a.minutes || b.playCount - a.playCount)
    .slice(0, 8);

  const topTracks = [...trackPlays.entries()]
    .map(([trackId, data]) => ({
      trackId,
      title: data.title,
      artistName: data.artistName,
      playCount: data.playCount,
    }))
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, 10);

  const recentlyDiscoveredArtists = [...artistFirstSeen.entries()]
    .filter(([, first]) => first >= cutoffMs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, firstPlayedAt]) => ({ name, firstPlayedAt }));

  return {
    timeRange: range,
    totalMinutes,
    playCount: totalPlays,
    completionRate,
    topArtists,
    topGenres,
    topTracks,
    recentlyDiscoveredArtists,
  };
}
