import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ProviderError,
} from '@sinc/shared';
import { errorHandler } from './error-handler.js';

interface AppErrorBody {
  status: number;
  code: string;
  message: string;
}

async function build() {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  app.route({
    method: 'GET',
    url: '/validated',
    schema: { querystring: { type: 'object', properties: { n: { type: 'integer' } } } },
    handler: async () => ({ ok: true }),
  });
  app.get('/auth-bomb', async () => {
    throw new AuthenticationError('please sign in');
  });
  app.get('/denied', async () => {
    throw new AuthorizationError();
  });
  app.get('/missing', async () => {
    throw new NotFoundError('track');
  });
  app.get('/upstream', async () => {
    throw new ProviderError('itunes', 'timed out');
  });
  app.get('/boom', async () => {
    throw new Error('kaboom');
  });
  return app;
}

describe('errorHandler', () => {
  it('maps validation failures to a 400 VALIDATION_ERROR envelope', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/validated?n=abc' });
    const body = res.json() as AppErrorBody;
    expect(res.statusCode).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.status).toBe(400);
  });

  it('propagates AppError status + code', async () => {
    const app = await build();
    const cases = [
      ['/auth-bomb', 401, 'AUTHENTICATION_ERROR'],
      ['/denied', 403, 'AUTHORIZATION_ERROR'],
      ['/missing', 404, 'NOT_FOUND'],
      ['/upstream', 502, 'PROVIDER_ERROR'],
    ] as const;
    for (const [url, status, code] of cases) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(status);
      expect(res.json().code).toBe(code);
    }
  });

  it('hides internal errors behind a generic 500 envelope', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/boom' });
    const body = res.json() as AppErrorBody;
    expect(res.statusCode).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('kaboom');
  });

  it('lets success responses through untouched', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/validated?n=1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
