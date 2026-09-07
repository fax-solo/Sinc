import type { LibraryPayload } from '../../api/music';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';

const CAP_PLAY_COUNTS = 300;
const CAP_ARTIST_PLAY_COUNTS = 100;
const CAP_SKIP_COUNTS = 300;
const CAP_COMPLETED_COUNTS = 300;
const CAP_THUMBS = 300;

/** Builds the local-library summary + listening signals sent with the personalized feed request. */
export function buildLibraryPayload(): LibraryPayload {
  const library = useLibraryStore.getState();
  const downloads = useDownloadsStore.getState().downloads;
  const downloadedTracks = downloads
    .filter((d) => d.phase === 'completed')
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, 20)
    .map((d) => d.track);

  const playStats = library.playStats;
  const playCounts = Object.entries(playStats)
    .map(([trackId, stat]) => ({ trackId, count: stat.count, lastPlayedAt: stat.lastPlayedAt }))
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, CAP_PLAY_COUNTS);
  const artistPlayCounts = Object.entries(library.artistPlayStats)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, CAP_ARTIST_PLAY_COUNTS);
  const skipCounts = Object.entries(library.skipStats)
    .map(([trackId, count]) => ({ trackId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, CAP_SKIP_COUNTS);
  const completedCounts = Object.entries(playStats)
    .filter(([, stat]) => stat.completedCount > 0)
    .map(([trackId, stat]) => ({ trackId, count: stat.completedCount }))
    .slice(0, CAP_COMPLETED_COUNTS);
  const thumbs = [
    ...Object.entries(library.thumbsUp).map(([targetId]) => ({
      targetId,
      value: 'up' as const,
    })),
    ...Object.entries(library.thumbsDown).map(([targetId]) => ({
      targetId,
      value: 'down' as const,
    })),
  ].slice(0, CAP_THUMBS);

  return {
    playlists: library.playlists.map((p) => ({
      id: p.id,
      name: p.name,
      artworkUrl: p.tracks.find((t) => t.artworkUrl)?.artworkUrl,
      trackCount: p.tracks.length,
      updatedAt: p.updatedAt,
    })),
    recentlyPlayedPlaylistIds: library.recentlyPlayedPlaylistIds,
    downloadedTracks,
    followedArtists: library.followedArtists,
    followedAlbums: library.followedAlbums,
    signals: {
      playCounts,
      artistPlayCounts,
      skipCounts,
      completedCounts,
      thumbs,
      hiddenTrackIds: library.hiddenTrackIds,
      hiddenArtistNames: library.hiddenArtistNames,
      discoveryPreference: library.discoveryPreference,
    },
  };
}
