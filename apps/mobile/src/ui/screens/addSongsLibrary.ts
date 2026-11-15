import type { CanonicalTrack } from '@sinc/shared';
import type { DownloadRecord } from '../../services/library/downloadsStore';

export type AddSongsSource = 'downloaded' | 'liked' | 'recent';

export interface AddSongsLibraryInput {
  downloads: DownloadRecord[];
  favorites: CanonicalTrack[];
  recentlyPlayed: CanonicalTrack[];
}

/** Every completed download, newest first (no suggestion cap). */
export function completedDownloadTracks(downloads: DownloadRecord[]): CanonicalTrack[] {
  return downloads
    .filter((record) => record.phase === 'completed' && record.localUri)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .map((record) => record.track);
}

/** The complete, deduplicated browse list for one Add Songs source tab. */
export function tracksForAddSongsSource(
  source: AddSongsSource,
  input: AddSongsLibraryInput
): CanonicalTrack[] {
  const pool =
    source === 'downloaded'
      ? completedDownloadTracks(input.downloads)
      : source === 'liked'
        ? input.favorites
        : input.recentlyPlayed;

  const seen = new Set<string>();
  const result: CanonicalTrack[] = [];
  for (const track of pool) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    result.push(track);
  }
  return result;
}

export function addSongsSourceLabel(source: AddSongsSource): string {
  if (source === 'downloaded') return 'DOWNLOADED';
  if (source === 'liked') return 'LIKED SONGS';
  return 'RECENTLY PLAYED';
}
