import { describe, expect, it } from 'vitest';
import {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalError,
  ProviderError,
  DownloadError,
  isAppError,
  getErrorResponse,
} from './errors/index.js';
import {
  RegisterSchema,
  LoginSchema,
  UserSchema,
  UserSettingsSchema,
  TrackSchema,
  UpdateSettingsSchema,
  PaginatedResponseSchema,
  RepeatModeSchema,
} from './schemas/index.js';

describe('error classes', () => {
  it('sets code/status/name per class', () => {
    expect(new AuthenticationError()).toMatchObject({
      name: 'AuthenticationError',
      code: 'AUTHENTICATION_ERROR',
      status: 401,
    });
    expect(new AuthorizationError()).toMatchObject({
      name: 'AuthorizationError',
      code: 'AUTHORIZATION_ERROR',
      status: 403,
    });
    expect(new NotFoundError('Song')).toMatchObject({
      name: 'NotFoundError',
      code: 'NOT_FOUND',
      status: 404,
      message: 'Song not found',
    });
    expect(new ConflictError('Taken')).toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(new RateLimitError()).toMatchObject({ code: 'RATE_LIMIT', status: 429 });
    expect(new InternalError()).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
    expect(new ProviderError('itunes', 'boom').details).toEqual({ provider: 'itunes' });
    expect(new DownloadError('nope').details).toEqual({ jobId: undefined });
  });

  it('ValidationError carries details through getErrorResponse', () => {
    const err = new ValidationError('Bad body', { fieldErrors: { email: ['invalid'] } });
    expect(isAppError(err)).toBe(true);
    expect(getErrorResponse(err)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Bad body',
      status: 400,
      details: { fieldErrors: { email: ['invalid'] } },
    });
  });

  it('getErrorResponse maps generic errors and unknowns', () => {
    expect(getErrorResponse(new Error('kaboom'))).toEqual({
      code: 'UNKNOWN_ERROR',
      message: 'kaboom',
      status: 500,
    });
    expect(getErrorResponse('string')).toEqual({
      code: 'UNKNOWN_ERROR',
      message: 'An unknown error occurred',
      status: 500,
    });
    expect(isAppError(new AppError('X', 'm'))).toBe(true);
  });
});

describe('auth schemas', () => {
  it('accepts a valid registration', () => {
    const parsed = RegisterSchema.safeParse({
      email: 'a@b.com',
      username: 'abc_1',
      password: 'password123',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects weak passwords and bad usernames', () => {
    expect(
      RegisterSchema.safeParse({ email: 'a@b.com', username: 'abc', password: 'short' }).success
    ).toBe(false);
    expect(
      RegisterSchema.safeParse({ email: 'a@b.com', username: 'has space', password: 'password123' })
        .success
    ).toBe(false);
    expect(
      RegisterSchema.safeParse({ email: 'not-an-email', username: 'abc', password: 'password123' })
        .success
    ).toBe(false);
  });

  it('LoginSchema only requires email + password', () => {
    expect(LoginSchema.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true);
    expect(LoginSchema.safeParse({ email: 'a@b.com' }).success).toBe(false);
  });
});

describe('content schemas', () => {
  const artist = { id: 'a1', name: 'Artist', providerIds: {}, genres: [] };
  const track = {
    id: 't1',
    title: 'Song',
    artists: [artist],
    durationMs: 180000,
    providerIds: {},
    explicit: false,
  };

  it('accepts a canonical track', () => {
    expect(TrackSchema.safeParse(track).success).toBe(true);
  });

  it('user settings include analyticsEnabled and validate enums', () => {
    expect(
      UserSettingsSchema.safeParse({
        theme: 'dark',
        playbackQuality: 'high',
        downloadQuality: 'high',
        downloadOverWifiOnly: true,
        autoDownloadFavorites: false,
        autoplay: true,
        shuffleDefault: false,
        repeatDefault: 'off',
        notifications: { downloads: true, recommendations: true, account: true },
        biometricLock: false,
        analyticsEnabled: false,
      }).success
    ).toBe(true);
    expect(UserSettingsSchema.safeParse({ ...track, theme: 'neon' } as never).success).toBe(false);
  });

  it('UpdateSettingsSchema is partial', () => {
    expect(UpdateSettingsSchema.safeParse({ theme: 'light' }).success).toBe(true);
    expect(UpdateSettingsSchema.safeParse({}).success).toBe(true);
  });

  it('PaginatedResponseSchema wraps arrays with meta', () => {
    const schema = PaginatedResponseSchema(TrackSchema);
    expect(
      schema.safeParse({ data: [track], meta: { page: 1, limit: 10, total: 1, totalPages: 1 } })
        .success
    ).toBe(true);
  });

  it('UserSchema enforces email and full settings', () => {
    expect(UserSchema.safeParse({ id: 'u1' }).success).toBe(false);
  });

  it('enum schemas constrain their values', () => {
    expect(RepeatModeSchema.safeParse('off').success).toBe(true);
    expect(RepeatModeSchema.safeParse('sometimes').success).toBe(false);
  });
});
