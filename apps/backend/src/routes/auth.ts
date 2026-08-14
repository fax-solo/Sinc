import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { success } from '@sinc/shared';
import type { TypedApp } from '../app.js';
import type { Container } from '../container.js';
import { authGuard, roleGuard } from '../plugins/guard.js';
import { rateLimitHook } from '../plugins/rate-limit.js';

const PasswordSchema = z.string().min(10).max(128);

const RegisterBody = z.object({
  email: z.string().email().max(254),
  password: PasswordSchema,
  username: z.string().regex(/^[a-zA-Z0-9_]{3,30}$/, '3-30 chars: letters, numbers, underscore'),
  displayName: z.string().max(60).optional(),
  locale: z.string().max(10).optional(),
});
type RegisterBodyInput = z.infer<typeof RegisterBody>;

const LoginBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});
type LoginBodyInput = z.infer<typeof LoginBody>;

const RefreshBody = z.object({
  refreshToken: z.string().min(16).max(512),
});
type RefreshBodyInput = z.infer<typeof RefreshBody>;

const VerifyEmailBody = z.object({
  token: z.string().min(16).max(512),
});
type VerifyEmailBodyInput = z.infer<typeof VerifyEmailBody>;

const EmailBody = z.object({
  email: z.string().email().max(254),
});
type EmailBodyInput = z.infer<typeof EmailBody>;

const PasswordResetConfirmBody = z.object({
  token: z.string().min(16).max(512),
  newPassword: PasswordSchema,
});
type PasswordResetConfirmBodyInput = z.infer<typeof PasswordResetConfirmBody>;

interface DeviceContext {
  deviceId: string;
  platform: string;
  ip: string | null;
  userAgent: string | null;
}

function deviceContext(request: FastifyRequest): DeviceContext {
  const deviceId = (request.headers['x-device-id'] as string | undefined) ?? 'anonymous';
  const platform = (request.headers['x-platform'] as string | undefined) ?? 'unknown';
  return {
    deviceId,
    platform,
    ip: request.ip ?? null,
    userAgent: (request.headers['user-agent'] as string | undefined) ?? null,
  };
}

export async function registerAuthRoutes(
  app: TypedApp,
  opts: { container: Container },
): Promise<void> {
  const { container } = opts;
  const guard = authGuard(container.tokenService);

  app.post<{ Body: RegisterBodyInput }>('/auth/register', {
    preHandler: [rateLimitHook(container.rateLimiter, 'auth:register')],
    handler: async (request, reply) => {
      const body = RegisterBody.parse(request.body);
      const device = deviceContext(request);
      const result = await container.authService.register({
        ...body,
        deviceId: device.deviceId,
        platform: device.platform,
        ip: device.ip,
        userAgent: device.userAgent,
      });
      return reply.code(201).send(success(result, request.id));
    },
  });

  app.post<{ Body: LoginBodyInput }>('/auth/login', {
    preHandler: [rateLimitHook(container.rateLimiter, 'auth:login')],
    handler: async (request, reply) => {
      const body = LoginBody.parse(request.body);
      const device = deviceContext(request);
      const result = await container.authService.login({
        email: body.email,
        password: body.password,
        deviceId: device.deviceId,
        platform: device.platform,
        ip: device.ip,
        userAgent: device.userAgent,
      });
      return reply.send(success(result, request.id));
    },
  });

  app.post<{ Body: RefreshBodyInput }>('/auth/refresh', {
    preHandler: [rateLimitHook(container.rateLimiter, 'auth:refresh')],
    handler: async (request, reply) => {
      const body = RefreshBody.parse(request.body);
      const device = deviceContext(request);
      const result = await container.authService.refresh({
        refreshToken: body.refreshToken,
        deviceId: device.deviceId,
        ip: device.ip,
        userAgent: device.userAgent,
      });
      return reply.send(success(result, request.id));
    },
  });

  app.post<{ Body: RefreshBodyInput }>('/auth/logout', {
    preHandler: [rateLimitHook(container.rateLimiter, 'auth:logout')],
    handler: async (request, reply) => {
      const body = RefreshBody.parse(request.body);
      await container.authService.logout(body.refreshToken);
      return reply.send(success({ loggedOut: true }, request.id));
    },
  });

  app.post<{ Body: VerifyEmailBodyInput }>('/auth/verify-email', {
    preHandler: [rateLimitHook(container.rateLimiter, 'auth:verify')],
    handler: async (request, reply) => {
      const body = VerifyEmailBody.parse(request.body);
      const device = deviceContext(request);
      const result = await container.authService.verifyEmail(
        body.token,
        device.deviceId,
        device.platform,
      );
      return reply.send(success(result, request.id));
    },
  });

  app.get<{ Querystring: { token?: string } }>('/auth/verify-email', {
    preHandler: [rateLimitHook(container.rateLimiter, 'auth:verify')],
    handler: async (request, reply) => {
      const parsed = VerifyEmailBody.parse({ token: request.query.token ?? '' });
      const device = deviceContext(request);
      const result = await container.authService.verifyEmail(
        parsed.token,
        device.deviceId,
        device.platform,
      );
      return reply.send(success(result, request.id));
    },
  });

  app.post<{ Body: EmailBodyInput }>('/auth/resend-verification', {
    preHandler: [rateLimitHook(container.rateLimiter, 'auth:resend')],
    handler: async (request, reply) => {
      const body = EmailBody.parse(request.body);
      await container.authService.resendVerification(body.email);
      return reply.send(success({ sent: true }, request.id));
    },
  });

  app.post<{ Body: EmailBodyInput }>('/auth/password-reset/request', {
    preHandler: [rateLimitHook(container.rateLimiter, 'auth:reset-request')],
    handler: async (request, reply) => {
      const body = EmailBody.parse(request.body);
      await container.authService.requestPasswordReset(body.email);
      return reply.send(success({ sent: true }, request.id));
    },
  });

  app.post<{ Body: PasswordResetConfirmBodyInput }>('/auth/password-reset/confirm', {
    preHandler: [rateLimitHook(container.rateLimiter, 'auth:reset-confirm')],
    handler: async (request, reply) => {
      const body = PasswordResetConfirmBody.parse(request.body);
      await container.authService.confirmPasswordReset(body.token, body.newPassword);
      return reply.send(success({ reset: true }, request.id));
    },
  });

  app.get('/auth/me', {
    onRequest: [guard],
    handler: async (request, reply) => {
      const { user, settings } = await container.authService.getMe(request.auth!.userId);
      return reply.send(success({ user, settings }, request.id));
    },
  });

  app.get('/auth/sessions', {
    onRequest: [guard],
    handler: async (request, reply) => {
      const sessions = await container.authService.listSessions(
        request.auth!.userId,
        request.auth!.jti,
      );
      return reply.send(success({ sessions }, request.id));
    },
  });

  app.delete<{ Params: { id: string } }>('/auth/sessions/:id', {
    onRequest: [guard],
    handler: async (request, reply) => {
      await container.authService.revokeSession(request.auth!.userId, request.params.id);
      return reply.send(success({ revoked: true }, request.id));
    },
  });

  app.delete('/auth/sessions', {
    onRequest: [guard],
    handler: async (request, reply) => {
      await container.authService.revokeAllSessions(request.auth!.userId);
      return reply.send(success({ revokedAll: true }, request.id));
    },
  });

  // Admin-only guard is registered for future admin routes
  void roleGuard;
}
