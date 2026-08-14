/**
 * Consistent API envelope + pagination shared by client and server.
 */

import type { ErrorCode } from '../errors.js';

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
  };
}

export function paginate<T>(items: T[], total: number, params: PaginationParams): Paginated<T> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    data: items,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
    },
  };
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
  requestId: string;
  serverTime: string;
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId: string;
  serverTime: string;
}

export function success<T>(data: T, requestId: string, meta?: PaginationMeta): ApiSuccess<T> {
  return {
    success: true,
    data,
    ...(meta ? { meta } : {}),
    requestId,
    serverTime: new Date().toISOString(),
  };
}

export function errorBody(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): ApiErrorBody {
  return {
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
    requestId,
    serverTime: new Date().toISOString(),
  };
}
