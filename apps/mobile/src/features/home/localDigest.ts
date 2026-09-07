import { useMemo } from 'react';
import type { CanonicalPlaylist, CanonicalTrack } from '@sinc/shared';
import type { HomeSection } from '../../api/music';
import type { LocalPlaylist, PlayStat } from '../../services/library/libraryStore';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';

export interface DigestInput {
  recentlyPlayed: CanonicalTrack[];
  favoriteTracks: CanonicalTrack[];
  playStats: Record<string, PlayStat>;
  skipStats: Record<string, number>;
  hiddenTrackIds: string[];
  hiddenArtistNames: string[];
  playlists: LocalPlaylist[];
  recentlyPlayedPlaylistIds: string[];
  /** Completed downloads, newest first. */
  downloadedTracks: CanonicalTrack[];
}

const MAX_RAIL = 8;
const MAX_PLAYLISTS = 6;
const ON_REPEAT_MIN = 2;
const SKIP_HEAVY_RATIO = 0.7;

function toCanonicalPlaylist(p: LocalPlaylist): CanonicalPlaylist {
  return {
    id: p.id,
    name: p.name,
    artworkUrl: p.tracks.find((t) => t.artworkUrl)?.artworkUrl,
    owner: { id: 'local', name: 'You' },
    isCollaborative: false,
    trackCount: p.tracks.length,
    providerIds: {},
    createdAt: new Date(p.createdAt).toISOString(),
    updatedAt: new Date(p.updatedAt).toISOString(),
  };
}

/** Builds Home rails purely from on-device library state (instant/offline digest). */
export function buildLocalSections(input: DigestInput): HomeSection[] {
  const sections: HomeSection[] = [];

  if (input.recentlyPlayed.length > 0) {
    sections.push({
      kind: 'recently-played',
      title: 'Recently played',
      tracks: input.recentlyPlayed.slice(0, MAX_RAIL),
    });
  }

  const known = new Map<string, CanonicalTrack>();
  for (const track of [
    ...input.recentlyPlayed,
    ...input.favoriteTracks,
    ...input.downloadedTracks,
  ]) {
    if (!known.has(track.id)) known.set(track.id, track);
  }

  const hiddenArtists = new Set(input.hiddenArtistNames);
  const repeat = Object.entries(input.playStats)
    .filter(([, stat]) => stat.count >= ON_REPEAT_MIN)
    .sort((a, b) => b[1].count - a[1].count || b[1].lastPlayedAt - a[1].lastPlayedAt)
    .map(([trackId]) => known.get(trackId))
    .filter((track): track is CanonicalTrack => {
      if (!track) return false;
      if (input.hiddenTrackIds.includes(track.id)) return false;
      if (track.artists[0]?.name && hiddenArtists.has(track.artists[0].name)) return false;
      const total = input.playStats[track.id]?.count ?? 0;
      if (total > 0 && (input.skipStats[track.id] ?? 0) / total > SKIP_HEAVY_RATIO) return false;
      return true;
    })
    .slice(0, MAX_RAIL);
  if (repeat.length > 0) {
    sections.push({ kind: 'tracks', title: 'On repeat', tracks: repeat });
  }

  const saved = input.downloadedTracks
    .filter((track) => {
      if (input.hiddenTrackIds.includes(track.id)) return false;
      if (track.artists[0]?.name && hiddenArtists.has(track.artists[0].name)) return false;
      return true;
    })
    .slice(0, MAX_RAIL);
  if (saved.length > 0) {
    sections.push({ kind: 'tracks', title: 'Saved for you', tracks: saved });
  }

  const recentSet = new Set(input.recentlyPlayedPlaylistIds);
  const ordered = [
    ...[...recentSet]
      .map((id) => input.playlists.find((p) => p.id === id))
      .filter((p): p is LocalPlaylist => Boolean(p)),
    ...input.playlists
      .filter((p) => !recentSet.has(p.id))
      .sort((a, b) => b.updatedAt - a.updatedAt),
  ].slice(0, MAX_PLAYLISTS);
  if (ordered.length > 0) {
    sections.push({
      kind: 'quick-access',
      title: 'Your playlists',
      playlists: ordered.map(toCanonicalPlaylist),
    });
  }

  return sections;
}

/** Subscribes to library/download state and renders the local digest synchronously. */
export function useLocalDigest(): HomeSection[] {
  const recentlyPlayed = useLibraryStore((s) => s.recentlyPlayed);
  const favoriteTracks = useLibraryStore((s) => s.favoriteTracks);
  const playStats = useLibraryStore((s) => s.playStats);
  const skipStats = useLibraryStore((s) => s.skipStats);
  const hiddenTrackIds = useLibraryStore((s) => s.hiddenTrackIds);
  const hiddenArtistNames = useLibraryStore((s) => s.hiddenArtistNames);
  const playlists = useLibraryStore((s) => s.playlists);
  const recentlyPlayedPlaylistIds = useLibraryStore((s) => s.recentlyPlayedPlaylistIds);
  const downloads = useDownloadsStore((s) => s.downloads);

  return useMemo(() => {
    const downloadedTracks = downloads
      .filter((d) => d.phase === 'completed')
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .map((d) => d.track);
    return buildLocalSections({
      recentlyPlayed,
      favoriteTracks,
      playStats,
      skipStats,
      hiddenTrackIds,
      hiddenArtistNames,
      playlists,
      recentlyPlayedPlaylistIds,
      downloadedTracks,
    });
  }, [
    recentlyPlayed,
    favoriteTracks,
    playStats,
    skipStats,
    hiddenTrackIds,
    hiddenArtistNames,
    playlists,
    recentlyPlayedPlaylistIds,
    downloads,
  ]);
}
