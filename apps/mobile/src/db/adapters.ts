import type { CanonicalTrack } from '@sinc/shared';
import type { Track } from './models';

/** Maps a local library track to the shared canonical shape (for TrackRow and playback). */
export function toCanonicalTrack(track: Track, artistName?: string): CanonicalTrack {
  return {
    id: track.id,
    title: track.title,
    normalizedTitle: track.normalizedTitle,
    artists: track.artistId && artistName ? [{ id: track.artistId, name: artistName }] : [],
    album: track.albumId ? { id: track.albumId, title: track.title } : undefined,
    durationMs: track.durationMs ?? 0,
    artworkUrl: track.artworkUrl ?? undefined,
    trackNumber: track.trackNumber ?? undefined,
    providerIds: track.providerId ? { musicbrainz: track.providerId } : {},
    providerConfidence: 1,
  };
}

/** Resolves artist names for a list of local tracks (async relations). */
export async function resolveArtistNames(tracks: Track[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  await Promise.all(
    tracks.map(async (track) => {
      if (!track.artistId) return;
      const artist = await track.artist.fetch();
      names.set(track.id, artist.name);
    }),
  );
  return names;
}
