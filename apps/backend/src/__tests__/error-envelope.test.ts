import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp, type TypedApp } from '../app.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  ErrorCodes,
  type ApiErrorBody,
} from '@sinc/shared';
import { buildTestEnv } from './health.test.js';

async function errorRoutes(app: TypedApp): Promise<void> {
  app.get('/boom/not-found', () => {
    throw new NotFoundError('Track not found');
  });
  app.get('/boom/conflict', () => {
    throw new ConflictError('Download already in progress');
  });
  app.get('/boom/validation', () => {
    throw new ValidationError('Bad input', { field: ['required'] });
  });
  app.get('/boom/internal', () => {
    throw new Error('kaboom');
  });
}

describe('error envelope', () => {
  let app: TypedApp;

  beforeAll(async () => {
    app = await buildApp({ env: { ...buildTestEnv() } });
    await errorRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('maps NotFoundError to 404 with code', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom/not-found' });
    expect(res.statusCode).toBe(404);
    const body = res.json<ApiErrorBody>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(body.error.message).toBe('Track not found');
  });

  it('maps ConflictError to 409', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom/conflict' });
    expect(res.statusCode).toBe(409);
    const body = res.json<ApiErrorBody>();
    expect(body.error.code).toBe(ErrorCodes.CONFLICT);
  });

  it('includes validation details', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom/validation' });
    expect(res.statusCode).toBe(400);
    const body = res.json<ApiErrorBody>();
    expect(body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(body.error.details).toEqual({ field: ['required'] });
  });

  it('never leaks internal errors', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom/internal' });
    expect(res.statusCode).toBe(500);
    const body = res.json<ApiErrorBody>();
    expect(body.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(body.error.message).toBe('Internal server error');
    expect(body.error.message).not.toContain('kaboom');
  });

  it('404s unknown routes with envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(res.statusCode).toBe(404);
    const body = res.json<ApiErrorBody>();
    expect(body.success).toBe(false);
  });
});
