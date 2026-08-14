/**
 * Machine-readable error codes and typed error classes shared across the
 * API boundary (backend emits them, mobile maps them to UX states).
 */

export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  DOWNLOAD_IN_PROGRESS: 'DOWNLOAD_IN_PROGRESS',
  STORAGE_FULL: 'STORAGE_FULL',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  OFFLINE: 'OFFLINE',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ErrorDetails {
  [key: string]: unknown;
}

export class SincError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetails;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { status?: number; details?: ErrorDetails; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'SincError';
    this.code = code;
    this.status = opts.status ?? defaultStatusFor(code);
    this.details = opts.details;
    this.retryable = opts.retryable ?? false;
  }
}

export class ValidationError extends SincError {
  constructor(message: string, details?: ErrorDetails) {
    super(ErrorCodes.VALIDATION_ERROR, message, { status: 400, details });
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends SincError {
  constructor(message = 'Authentication required') {
    super(ErrorCodes.UNAUTHORIZED, message, { status: 401 });
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends SincError {
  constructor(message = 'Insufficient permissions') {
    super(ErrorCodes.FORBIDDEN, message, { status: 403 });
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends SincError {
  constructor(message = 'Resource not found') {
    super(ErrorCodes.NOT_FOUND, message, { status: 404 });
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends SincError {
  constructor(message = 'Resource conflict') {
    super(ErrorCodes.CONFLICT, message, { status: 409 });
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends SincError {
  constructor(message = 'Too many requests', details?: ErrorDetails) {
    super(ErrorCodes.RATE_LIMITED, message, { status: 429, details });
    this.name = 'RateLimitError';
  }
}

export class SourceUnavailableError extends SincError {
  constructor(message = 'Source unavailable') {
    super(ErrorCodes.SOURCE_UNAVAILABLE, message, { status: 404, retryable: true });
    this.name = 'SourceUnavailableError';
  }
}

export class ProviderError extends SincError {
  readonly provider: string;

  constructor(provider: string, message = `Provider "${provider}" failed`) {
    super(ErrorCodes.PROVIDER_ERROR, message, { status: 502, retryable: true });
    this.name = 'ProviderError';
    this.provider = provider;
  }
}

export class OfflineError extends SincError {
  constructor(message = 'You are offline') {
    super(ErrorCodes.OFFLINE, message, { status: 0 });
    this.name = 'OfflineError';
  }
}

function defaultStatusFor(code: ErrorCode): number {
  switch (code) {
    case ErrorCodes.VALIDATION_ERROR:
      return 400;
    case ErrorCodes.UNAUTHORIZED:
    case ErrorCodes.TOKEN_EXPIRED:
    case ErrorCodes.TOKEN_REVOKED:
    case ErrorCodes.INVALID_CREDENTIALS:
      return 401;
    case ErrorCodes.FORBIDDEN:
    case ErrorCodes.ACCOUNT_SUSPENDED:
    case ErrorCodes.EMAIL_NOT_VERIFIED:
      return 403;
    case ErrorCodes.NOT_FOUND:
    case ErrorCodes.SOURCE_UNAVAILABLE:
      return 404;
    case ErrorCodes.CONFLICT:
    case ErrorCodes.DOWNLOAD_IN_PROGRESS:
      return 409;
    case ErrorCodes.RATE_LIMITED:
    case ErrorCodes.STORAGE_FULL:
      return 429;
    default:
      return 500;
  }
}

/** Guard: is a thrown value a SincError with the given code? */
export function isSincError(error: unknown, code?: ErrorCode): error is SincError {
  if (!(error instanceof SincError)) return false;
  return code === undefined || error.code === code;
}
