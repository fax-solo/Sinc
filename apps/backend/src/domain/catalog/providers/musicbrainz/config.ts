/** MusicBrainz-specific endpoints, headers and rate-limit policy. */

export const MUSICBRAINZ_BASE_URL = 'https://musicbrainz.org/ws/2';

export const MUSICBRAINZ_USER_AGENT =
  'Sinc/0.1 (https://github.com/anomalyco/sinc; dev@example.com)';

/** MusicBrainz asks for max 1 req/s; we stay well under that. */
export const MUSICBRAINZ_MIN_INTERVAL_MS = 1_100;

export const MUSICBRAINZ_TIMEOUT_MS = 8_000;

export const MUSICBRAINZ_RETRIES = 1;

export const ARTIST_INC = 'url-rels+genres+tags+artist-rels';
export const RELEASE_GROUP_INC = 'artist-credits+releases+genres';
export const RELEASE_INC = 'recordings+artist-credits';
export const RECORDING_INC = 'artist-credits+releases+genres';
