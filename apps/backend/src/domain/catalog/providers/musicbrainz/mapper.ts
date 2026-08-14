import type { RawAlbum, RawArtist, RawTrack } from '@sinc/shared';
import type { CanonicalAlbum } from '@sinc/shared';

/** Loosely-typed MusicBrainz ws/2 JSON shapes (fields we read). */

export interface MbArtistCreditEntry {
  name?: string;
  artist?: { id?: string; name?: string; type?: string; 'sort-name'?: string };
}

export interface MbReleaseRef {
  id?: string;
  title?: string;
  date?: string;
  'release-group'?: { id?: string; title?: string; 'primary-type'?: string };
}

export interface MbRecording {
  id?: string;
  title?: string;
  length?: number;
  score?: number;
  'artist-credit'?: MbArtistCreditEntry[];
  'first-release-date'?: string;
  isrcs?: string[];
  releases?: MbReleaseRef[];
}

export interface MbArtist {
  id?: string;
  name?: string;
  type?: string;
  disambiguation?: string;
  'sort-name'?: string;
  area?: { name?: string };
  'life-span'?: { begin?: string; end?: string; ended?: boolean };
  tags?: Array<{ name?: string }>;
  genres?: Array<{ name?: string }>;
  relations?: Array<{
    type?: string;
    target?: string;
    artist?: MbArtist;
  }>;
}

export interface MbReleaseTrack {
  number?: string;
  position?: number;
  title?: string;
  length?: number;
  recording?: { id?: string; title?: string; isrcs?: string[] };
}

export interface MbRelease {
  id?: string;
  title?: string;
  date?: string;
  status?: string;
  'artist-credit'?: MbArtistCreditEntry[];
  media?: Array<{
    position?: number;
    format?: string;
    'track-count'?: number;
    track?: MbReleaseTrack[];
  }>;
}

export interface MbReleaseGroup {
  id?: string;
  title?: string;
  'primary-type'?: string;
  'secondary-types'?: string[];
  'first-release-date'?: string;
  'artist-credit'?: MbArtistCreditEntry[];
  'release-list'?: MbRelease[];
}

export function creditNames(credit?: MbArtistCreditEntry[]): string[] {
  if (!credit) return [];
  return credit
    .map((entry) => entry?.artist?.name ?? entry?.name)
    .filter((name): name is string => !!name);
}

export function mapRecording(raw: MbRecording): RawTrack | null {
  if (!raw.id || !raw.title) return null;
  const release = raw.releases?.[0];
  return {
    provider: 'musicbrainz',
    providerId: raw.id,
    title: raw.title,
    artistNames: creditNames(raw['artist-credit']),
    albumTitle: release?.['release-group']?.title ?? release?.title,
    durationMs: raw.length != null && raw.length > 0 ? raw.length : undefined,
    isrc: raw.isrcs?.[0],
    releaseDate: raw['first-release-date'],
    trackNumber: undefined,
  };
}

export function mapSearchRecording(raw: MbRecording): RawTrack | null {
  const track = mapRecording(raw);
  if (!track) return null;
  if (raw.score != null) track.popularity = Math.min(100, raw.score);
  return track;
}

export function mapArtist(raw: MbArtist): RawArtist | null {
  if (!raw.id || !raw.name) return null;
  const variants: string[] = [];
  if (raw['sort-name'] && raw['sort-name'] !== raw.name) variants.push(raw['sort-name']);
  if (raw.disambiguation) variants.push(raw.disambiguation);
  return {
    provider: 'musicbrainz',
    providerId: raw.id,
    name: raw.name,
    nameVariants: variants,
    genres: [
      ...new Set(
        [...(raw.genres ?? []), ...(raw.tags ?? [])]
          .map((t) => t?.name)
          .filter((n): n is string => !!n),
      ),
    ],
  };
}

export function mapPrimaryType(type: string | undefined): CanonicalAlbum['type'] {
  switch (type) {
    case 'Album':
      return 'ALBUM';
    case 'Single':
      return 'SINGLE';
    case 'EP':
      return 'EP';
    case 'Compilation':
      return 'COMPILATION';
    case 'Soundtrack':
      return 'SOUNDTRACK';
    default:
      return 'ALBUM';
  }
}

export function mapReleaseGroup(raw: MbReleaseGroup): RawAlbum | null {
  if (!raw.id || !raw.title) return null;
  const tracks = raw['release-list']?.reduce((sum, release) => {
    return sum + (release.media?.reduce((s, m) => s + (m['track-count'] ?? 0), 0) ?? 0);
  }, 0);
  return {
    provider: 'musicbrainz',
    providerId: raw.id,
    title: raw.title,
    artistNames: creditNames(raw['artist-credit']),
    releaseDate: raw['first-release-date'],
    totalTracks: tracks && tracks > 0 ? tracks : undefined,
    type: mapPrimaryType(raw['primary-type']),
  };
}

/** Choose the release most likely to represent the group (official, earliest). */
export function pickRelease(group: MbReleaseGroup): MbRelease | undefined {
  const releases = (group['release-list'] ?? []).filter((r) => r && r.id && r.title);
  if (releases.length === 0) return undefined;
  return releases.sort((a, b) => {
    const aOfficial = a.status === 'Official' ? 0 : 1;
    const bOfficial = b.status === 'Official' ? 0 : 1;
    if (aOfficial !== bOfficial) return aOfficial - bOfficial;
    return (a.date ?? '').localeCompare(b.date ?? '');
  })[0];
}

export function mapReleaseTrack(track: MbReleaseTrack, release: MbRelease): RawTrack | null {
  if (!track.title) return null;
  return {
    provider: 'musicbrainz',
    providerId:
      track.recording?.id ?? `${release.id}:${track.position ?? track.number ?? track.title}`,
    title: track.title,
    artistNames: creditNames(release['artist-credit']),
    albumTitle: release.title,
    durationMs: track.length != null && track.length > 0 ? track.length : undefined,
    isrc: track.recording?.isrcs?.[0],
    trackNumber: track.position,
  };
}
