import { ProviderError } from '@sinc/shared';
import type {
  HealthResult,
  MetadataProvider,
  PageOpts,
  RawSearchResults,
  SearchOpts,
} from '../../types.js';
import { MusicBrainzHttp, MusicBrainzHttpError, type ProviderFetch } from './http.js';
import {
  mapArtist,
  mapRecording,
  mapReleaseGroup,
  mapReleaseTrack,
  mapSearchRecording,
  pickRelease,
  type MbArtist,
  type MbRecording,
  type MbRelease,
  type MbReleaseGroup,
} from './mapper.js';
import {
  ARTIST_INC,
  MUSICBRAINZ_MIN_INTERVAL_MS,
  RECORDING_INC,
  RELEASE_GROUP_INC,
  RELEASE_INC,
} from './config.js';

/** Query builder keeps MusicBrainz lucene syntax + limit/offset params. */
function buildQuery(params: Record<string, string | number | undefined>): string {
  const parts = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) parts.set(key, String(value));
  }
  parts.set('fmt', 'json');
  return `?${parts.toString()}`;
}

const ARTIST_NAME = /^[\w.&'-]+$/;
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Add a "recording:<id>" title qualifier when the query looks like an id. */
function qualifyRecordingQuery(query: string): string {
  const trimmed = query.trim();
  if (MBID.test(trimmed)) return `recording:${trimmed}`;
  return trimmed.replace(/\s+/g, ' ');
}

function qualifyNameQuery(query: string, field: 'artist' | 'release'): string {
  const trimmed = query.trim();
  if (MBID.test(trimmed)) return `${field}:${trimmed}`;
  if (ARTIST_NAME.test(trimmed)) return `${field}:"${trimmed}"`;
  return trimmed;
}

/**
 * Metadata provider backed by MusicBrainz ws/2. Maps responses to the shared
 * Raw* models; never leaks MusicBrainz shapes into domain code.
 */
export class MusicBrainzMetadataProvider implements MetadataProvider {
  readonly id = 'musicbrainz';
  readonly type = 'metadata' as const;

  constructor(
    private readonly http: MusicBrainzHttp = new MusicBrainzHttp(),
    private readonly minIntervalMs: number = MUSICBRAINZ_MIN_INTERVAL_MS,
  ) {}

  private lastRequestAt = 0;

  private async throttled<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const wait = this.lastRequestAt + this.minIntervalMs - now;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await fn();
    } finally {
      this.lastRequestAt = Date.now();
    }
  }

  async search(query: string, opts: SearchOpts = {}): Promise<RawSearchResults> {
    const limit = opts.limit ?? 10;
    const offset = opts.offset ?? 0;
    const q = qualifyRecordingQuery(query);

    const [recordingRes, artistRes, albumRes] = await Promise.all([
      this.throttled(() => this.http.get(`/recording${buildQuery({ query: q, limit, offset })}`)),
      this.throttled(() =>
        this.http.get(
          `/artist${buildQuery({ query: qualifyNameQuery(query, 'artist'), limit, offset })}`,
        ),
      ),
      this.throttled(() =>
        this.http.get(
          `/release-group${buildQuery({ query: qualifyNameQuery(query, 'release'), limit, offset })}`,
        ),
      ),
    ]);

    const recordings = ((recordingRes.recordings ?? []) as MbRecording[])
      .map(mapSearchRecording)
      .filter((t): t is NonNullable<typeof t> => t !== null);
    const artists = ((artistRes.artists ?? []) as MbArtist[])
      .map(mapArtist)
      .filter((a): a is NonNullable<typeof a> => a !== null);
    const albums = ((albumRes['release-groups'] ?? []) as MbReleaseGroup[])
      .map(mapReleaseGroup)
      .filter((a): a is NonNullable<typeof a> => a !== null);

    return { query, tracks: recordings, artists, albums };
  }

  async getTrack(id: string): Promise<import('@sinc/shared').RawTrack | null> {
    const body = await this.throttled(() =>
      this.http.get(`/recording/${id}${buildQuery({ inc: RECORDING_INC })}`),
    );
    if (body.error) throw new ProviderError('musicbrainz', body.error);
    return mapRecording(body as unknown as MbRecording);
  }

  async getArtist(id: string): Promise<import('@sinc/shared').RawArtist | null> {
    const body = await this.throttled(() =>
      this.http.get(`/artist/${id}${buildQuery({ inc: ARTIST_INC })}`),
    );
    if (body.error) throw new ProviderError('musicbrainz', body.error);
    return mapArtist(body as unknown as MbArtist);
  }

  async getAlbum(id: string): Promise<import('@sinc/shared').RawAlbum | null> {
    const body = await this.throttled(() =>
      this.http.get(`/release-group/${id}${buildQuery({ inc: RELEASE_GROUP_INC })}`),
    );
    if (body.error) throw new ProviderError('musicbrainz', body.error);
    return mapReleaseGroup(body as unknown as MbReleaseGroup);
  }

  async getArtistTracks(
    artistId: string,
    opts: PageOpts = {},
  ): Promise<import('@sinc/shared').RawTrack[]> {
    const body = await this.throttled(() =>
      this.http.get(
        `/artist/${artistId}/recordings${buildQuery({ limit: opts.limit ?? 50, offset: opts.offset ?? 0 })}`,
      ),
    );
    return ((body.recordings ?? []) as MbRecording[])
      .map(mapRecording)
      .filter((t): t is NonNullable<typeof t> => t !== null);
  }

  async getArtistAlbums(
    artistId: string,
    opts: PageOpts = {},
  ): Promise<import('@sinc/shared').RawAlbum[]> {
    const body = await this.throttled(() =>
      this.http.get(
        `/artist/${artistId}/release-groups${buildQuery({ limit: opts.limit ?? 50, offset: opts.offset ?? 0 })}`,
      ),
    );
    return ((body['release-groups'] ?? []) as MbReleaseGroup[])
      .map(mapReleaseGroup)
      .filter((a): a is NonNullable<typeof a> => a !== null);
  }

  async getAlbumTracks(
    albumId: string,
    opts: PageOpts = {},
  ): Promise<import('@sinc/shared').RawTrack[]> {
    const body = await this.throttled(() =>
      this.http.get(`/release-group/${albumId}${buildQuery({ inc: RELEASE_GROUP_INC })}`),
    );
    const group = body as unknown as MbReleaseGroup | undefined;
    if (!group?.id) return [];
    const release = pickRelease(group);
    if (!release) return [];

    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const releaseBody = await this.throttled(() =>
      this.http.get(`/release/${release.id}${buildQuery({ inc: RELEASE_INC })}`),
    );
    const detailed = releaseBody as unknown as MbRelease | undefined;
    if (!detailed) return [];

    const tracks = (detailed.media ?? [])
      .flatMap((media) => media.track ?? [])
      .map((track) => mapReleaseTrack(track, detailed))
      .filter((t): t is NonNullable<typeof t> => t !== null);
    return tracks.slice(offset, offset + limit);
  }

  async getRelatedArtists(artistId: string): Promise<import('@sinc/shared').RawArtist[]> {
    const body = await this.throttled(() =>
      this.http.get(`/artist/${artistId}${buildQuery({ inc: 'artist-rels' })}`),
    );
    const artist = body as unknown as MbArtist | undefined;
    const relations = artist?.relations ?? [];
    return relations
      .filter((relation) => relation.type === 'artist' && relation.artist)
      .map((relation) => mapArtist(relation.artist!))
      .filter((a): a is NonNullable<typeof a> => a !== null);
  }

  async healthCheck(): Promise<HealthResult> {
    const startedAt = Date.now();
    try {
      await this.throttled(() =>
        this.http.get(`/artist${buildQuery({ query: 'test', limit: 1 })}`),
      );
      return { ok: true, latencyMs: Date.now() - startedAt, checkedAt: new Date().toISOString() };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof MusicBrainzHttpError ? error.message : String(error),
        checkedAt: new Date().toISOString(),
      };
    }
  }
}

export { MusicBrainzHttp, MusicBrainzHttpError };
export type { ProviderFetch };
