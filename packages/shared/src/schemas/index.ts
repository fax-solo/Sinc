import { z } from 'zod';

export const ArtistSchema = z.object({
  id: z.string(),
  name: z.string(),
  artworkUrl: z.string().url().optional(),
  providerIds: z.record(z.string()),
  genres: z.array(z.string()),
  popularityScore: z.number().optional(),
});

export const AlbumSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: ArtistSchema,
  artworkUrl: z.string().url().optional(),
  releaseDate: z.string().optional(),
  year: z.number().optional(),
  trackCount: z.number(),
  providerIds: z.record(z.string()),
  type: z.enum(['album', 'single', 'compilation', 'ep']),
});

export const TrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  artists: z.array(ArtistSchema),
  album: AlbumSchema.optional(),
  durationMs: z.number(),
  trackNumber: z.number().optional(),
  artworkUrl: z.string().url().optional(),
  providerIds: z.record(z.string()),
  releaseDate: z.string().optional(),
  popularityScore: z.number().optional(),
  explicit: z.boolean(),
  isrc: z.string().optional(),
});

export const PlaylistSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  artworkUrl: z.string().url().optional(),
  owner: z.object({ id: z.string(), name: z.string() }),
  isCollaborative: z.boolean(),
  trackCount: z.number(),
  providerIds: z.record(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const UserSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  playbackQuality: z.enum(['low', 'medium', 'high', 'lossless']),
  downloadQuality: z.enum(['low', 'medium', 'high', 'lossless']),
  downloadOverWifiOnly: z.boolean(),
  autoDownloadFavorites: z.boolean(),
  autoplay: z.boolean(),
  shuffleDefault: z.boolean(),
  repeatDefault: z.enum(['off', 'one', 'all']),
  notifications: z.object({
    downloads: z.boolean(),
    recommendations: z.boolean(),
    account: z.boolean(),
  }),
  biometricLock: z.boolean(),
});

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  username: z.string(),
  displayName: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  createdAt: z.string(),
  settings: UserSettingsSchema,
});

export const PlaybackSourceSchema = z.object({
  uri: z.string().url(),
  headers: z.record(z.string()).optional(),
  mimeType: z.string().optional(),
  quality: z.enum(['low', 'medium', 'high', 'lossless']),
  provider: z.string(),
});

export const SearchSuggestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  type: z.enum(['song', 'artist', 'album', 'playlist']),
  subtitle: z.string().optional(),
  artworkUrl: z.string().url().optional(),
});

export const SearchResultSchema = z.object({
  tracks: z.array(z.object({ track: TrackSchema, score: z.number() })),
  artists: z.array(ArtistSchema),
  albums: z.array(AlbumSchema),
  playlists: z.array(PlaylistSchema),
});

export const PaginatedMetaSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    meta: PaginatedMetaSchema,
  });

export const PlaybackStateSchema = z.enum([
  'idle',
  'loading',
  'playing',
  'paused',
  'ended',
  'error',
]);
export const RepeatModeSchema = z.enum(['off', 'one', 'all']);
export const ShuffleModeSchema = z.enum(['off', 'on']);
export const DownloadStatusSchema = z.enum([
  'pending',
  'downloading',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);
export const DownloadQualitySchema = z.enum(['low', 'medium', 'high', 'lossless']);

export const RegisterSchema = z.object({
  email: z.string().email(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128),
  displayName: z.string().max(50).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const RefreshSchema = z.object({
  refreshToken: z.string(),
});

export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const ResetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8).max(128),
});

export const VerifyEmailSchema = z.object({
  token: z.string(),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8).max(128),
});

export const UpdateProfileSchema = z.object({
  displayName: z.string().max(50).optional(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/)
    .optional(),
  avatarUrl: z.string().url().optional(),
});

export const UpdateSettingsSchema = UserSettingsSchema.partial();

// Type inference helpers
export type Artist = z.infer<typeof ArtistSchema>;
export type Album = z.infer<typeof AlbumSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Playlist = z.infer<typeof PlaylistSchema>;
export type User = z.infer<typeof UserSchema>;
export type PlaybackState = z.infer<typeof PlaybackStateSchema>;
export type RepeatMode = z.infer<typeof RepeatModeSchema>;
export type ShuffleMode = z.infer<typeof ShuffleModeSchema>;
export type DownloadStatus = z.infer<typeof DownloadStatusSchema>;
export type DownloadQuality = z.infer<typeof DownloadQualitySchema>;

export const RequestPasswordResetSchema = ForgotPasswordSchema;
