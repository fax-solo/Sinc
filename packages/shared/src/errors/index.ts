export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, status = 500, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super('AUTHENTICATION_ERROR', message, 401);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super('AUTHORIZATION_ERROR', message, 403);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests', retryAfter?: number) {
    super('RATE_LIMIT', message, 429, { retryAfter });
    this.name = 'RateLimitError';
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error', details?: unknown) {
    super('INTERNAL_ERROR', message, 500, details);
    this.name = 'InternalError';
  }
}

export class ProviderError extends AppError {
  constructor(provider: string, message: string) {
    super('PROVIDER_ERROR', `${provider}: ${message}`, 502, { provider });
    this.name = 'ProviderError';
  }
}

export class DownloadError extends AppError {
  constructor(message: string, jobId?: string) {
    super('DOWNLOAD_ERROR', message, 500, { jobId });
    this.name = 'DownloadError';
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function getErrorResponse(error: unknown): {
  code: string;
  message: string;
  status: number;
  details?: unknown;
} {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details,
    };
  }
  if (error instanceof Error) {
    return { code: 'UNKNOWN_ERROR', message: error.message, status: 500 };
  }
  return { code: 'UNKNOWN_ERROR', message: 'An unknown error occurred', status: 500 };
}
