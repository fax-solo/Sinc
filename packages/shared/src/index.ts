/**
 * @sinc/shared - canonical domain model shared by mobile and backend.
 */

// IDs
export { ulid, ulidTime, isUlid } from './id.js';

// Normalization / fuzzy matching
export {
  normalizeTitle,
  normalizeArtist,
  stripVersion,
  levenshteinSimilarity,
  durationsCompatible,
  trackFingerprint,
} from './normalize.js';

// Errors
export {
  ErrorCodes,
  SincError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  SourceUnavailableError,
  ProviderError,
  OfflineError,
  isSincError,
} from './errors.js';
export type { ErrorCode, ErrorDetails } from './errors.js';

// Music domain
export * from './music/index.js';
export * from './music/source.js';
export * from './music/playlist.js';
export * from './music/home.js';

// Downloads
export { DownloadStatus, DOWNLOAD_TRANSITIONS, DownloadStateMachine } from './download/download.js';
export type {
  DownloadJob,
  CreateDownloadInput,
  DownloadProgress,
  DownloadQuality,
} from './download/download.js';

// Sync (playlists + favorites)
export { favoriteUnion } from './sync/sync.js';
export type {
  SyncFavoriteTarget,
  SyncFavorite,
  SyncPlaylist,
  SyncSnapshot,
  SyncMutation,
  SyncConflict,
  SyncApplyResult,
} from './sync/sync.js';

// Playback
export { PlaybackState, PLAYBACK_TRANSITIONS, PlaybackStateMachine } from './playback/playback.js';
export type {
  PlaybackPositionState,
  PlaybackError,
  QueueTrackRef,
  ShuffleMode,
  RepeatMode,
  PlaybackSourceKind,
} from './playback/playback.js';

// Lyrics
export { MIN_LYRICS_CONFIDENCE } from './lyrics/lyrics.js';
export type {
  SyncedLyricLine,
  LyricsResult,
  LyricsCandidate,
  LyricsCacheEntry,
} from './lyrics/lyrics.js';

// Auth / user
export { ROLE_RANK, hasRoleAtLeast, DEFAULT_USER_SETTINGS } from './auth/user.js';
export type {
  Role,
  UserStatus,
  PublicUser,
  User,
  UserSettings,
  AuthResult,
  SessionInfo,
  NotificationPreferences,
} from './auth/user.js';

// API envelope
export { paginate, success, errorBody } from './api/envelope.js';
export type { PaginationParams, Paginated, ApiSuccess, ApiErrorBody } from './api/envelope.js';
