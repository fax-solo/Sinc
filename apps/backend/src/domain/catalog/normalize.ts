import {
  type AlbumLite,
  type ArtistLite,
  type CanonicalAlbum,
  type CanonicalArtist,
  type CanonicalTrack,
  type RawAlbum,
  type RawArtist,
  type RawTrack,
  normalizeArtist,
  normalizeTitle,
  stripVersion,
  trackFingerprint,
  ulid,
} from '@sinc/shared';

/** Fields that make a record more trustworthy as a group representative. */
export function completenessScore(raw: RawTrack): number {
  let score = 0;
  if (raw.isrc) score += 2;
  if (raw.durationMs != null && raw.durationMs > 0) score += 2;
  if (raw.albumTitle) score += 1;
  if (raw.artworkUrl) score += 1;
  if (raw.releaseDate) score += 1;
  if (raw.trackNumber != null) score += 1;
  if (raw.popularity != null && raw.popularity > 0) score += 1;
  return score;
}

/** Provider reliability weights used to break ties between candidates. */
export const PROVIDER_CONFIDENCE: Record<string, number> = {
  musicbrainz: 0.95,
  lastfm: 0.8,
  deezer: 0.9,
  itunes: 0.85,
};

/** Convert a provider RawTrack into the app's canonical shape. */
export function toCanonicalTrack(raw: RawTrack): CanonicalTrack {
  const artists: ArtistLite[] = raw.artistNames.map((name) => ({
    id: ulid(),
    name,
  }));
  const album: AlbumLite | undefined = raw.albumTitle
    ? { id: ulid(), title: raw.albumTitle }
    : undefined;
  const version = raw.version ?? extractVersion(raw.title);

  return {
    id: ulid(),
    title: raw.title,
    normalizedTitle: normalizeTitle(raw.title),
    artists,
    album,
    durationMs: raw.durationMs ?? 0,
    artworkUrl: raw.artworkUrl,
    isrc: raw.isrc,
    releaseDate: raw.releaseDate,
    explicit: raw.explicit,
    version,
    trackNumber: raw.trackNumber,
    providerIds: { [raw.provider]: raw.providerId },
    providerConfidence: PROVIDER_CONFIDENCE[raw.provider] ?? 0.5,
  };
}

/** Pull a "Remix"/"Live"/etc. suffix out of the title for display metadata. */
export function extractVersion(title: string): string | undefined {
  const match = title.match(/\s*\(([^)]*)\)\s*$/);
  if (match?.[1]) return match[1].trim() || undefined;
  const dash = title.match(/\s*-\s*([^-\s][^-]*)$/i);
  if (dash?.[1] && /^(remix|acoustic|live|instrumental|extended|edit|mix)$/i.test(dash[1].trim())) {
    return dash[1].trim();
  }
  return undefined;
}

/** Convert a provider RawArtist into the app's canonical shape. */
export function toCanonicalArtist(raw: RawArtist): CanonicalArtist {
  return {
    id: ulid(),
    name: raw.name,
    normalizedName: normalizeArtist(raw.name),
    nameVariants: raw.nameVariants ?? [],
    biography: raw.biography,
    artworkUrl: raw.artworkUrl,
    genres: raw.genres ?? [],
    followerCount: raw.followerCount,
    providerIds: { [raw.provider]: raw.providerId },
  };
}

/** Convert a provider RawAlbum into the app's canonical shape. */
export function toCanonicalAlbum(raw: RawAlbum): CanonicalAlbum {
  return {
    id: ulid(),
    title: raw.title,
    normalizedTitle: normalizeTitle(raw.title),
    type: raw.type ?? 'ALBUM',
    releaseDate: raw.releaseDate,
    releaseYear: raw.releaseDate ? new Date(raw.releaseDate).getUTCFullYear() : undefined,
    totalTracks: raw.totalTracks,
    totalDurationMs: raw.totalDurationMs,
    artworkUrl: raw.artworkUrl,
    providerIds: { [raw.provider]: raw.providerId },
  };
}

export { normalizeArtist, normalizeTitle, stripVersion, trackFingerprint };
