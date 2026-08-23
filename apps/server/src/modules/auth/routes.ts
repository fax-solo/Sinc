import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError, LoginSchema, RefreshSchema, RegisterSchema } from '@sinc/shared';
import type { AuthService } from './service.js';
import type { TokenService } from './tokens.js';
import { authGuard } from '../../plugins/guard.js';
import type { AuthenticatedRequest } from '../../plugins/guard.js';

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid request body', 400, parsed.error.flatten());
  }
  return parsed.data;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  tokenService: TokenService
): void {
  const guard = authGuard(tokenService);

  app.post('/auth/register', { config: { rateLimit: { max: 10 } } }, async (request, reply) => {
    const data = parseBody(RegisterSchema, request.body);
    const result = await authService.register(data, request.headers['user-agent'], request.ip);
    return reply.status(201).send(result);
  });

  app.post('/auth/login', { config: { rateLimit: { max: 20 } } }, async (request) => {
    const data = parseBody(LoginSchema, request.body);
    return authService.login(data, request.headers['user-agent'], request.ip);
  });

  app.post('/auth/refresh', { config: { rateLimit: { max: 30 } } }, async (request) => {
    const data = parseBody(RefreshSchema, request.body);
    return authService.refresh(data.refreshToken, request.headers['user-agent'], request.ip);
  });

  app.post('/auth/logout', async (request) => {
    const data = parseBody(RefreshSchema, request.body);
    await authService.logoutWithRefreshToken(data.refreshToken);
    return { success: true };
  });

  app.get('/auth/me', { preHandler: guard }, async (request) => {
    const { userId } = (request as AuthenticatedRequest).auth;
    return authService.me(userId);
  });
}
