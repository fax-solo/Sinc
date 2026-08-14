import { z } from 'zod';
import { success } from '@sinc/shared';
import type { TypedApp } from '../app.js';
import type { Container } from '../container.js';
import { authGuard } from '../plugins/guard.js';

const UpdateProfileBody = z.object({
  displayName: z.string().max(60).optional(),
  username: z
    .string()
    .regex(/^[a-zA-Z0-9_]{3,30}$/, '3-30 chars: letters, numbers, underscore')
    .optional(),
  avatarUrl: z.string().url().max(1024).nullable().optional(),
  locale: z.string().max(10).optional(),
});
type UpdateProfileBodyInput = z.infer<typeof UpdateProfileBody>;

const DeleteAccountBody = z.object({
  password: z.string().min(1).max(200),
  confirmation: z.string(),
});
type DeleteAccountBodyInput = z.infer<typeof DeleteAccountBody>;

const SettingsPatch = z.object({
  playback: z.record(z.string(), z.unknown()).optional(),
  downloads: z.record(z.string(), z.unknown()).optional(),
  lyrics: z.record(z.string(), z.unknown()).optional(),
  appearance: z.record(z.string(), z.unknown()).optional(),
  privacy: z.record(z.string(), z.unknown()).optional(),
  security: z.record(z.string(), z.unknown()).optional(),
  dataSaver: z.record(z.string(), z.unknown()).optional(),
});
type SettingsPatchInput = z.infer<typeof SettingsPatch>;

export async function registerUserRoutes(
  app: TypedApp,
  opts: { container: Container },
): Promise<void> {
  const { container } = opts;
  const guard = authGuard(container.tokenService);

  app.get('/users/me', {
    onRequest: [guard],
    handler: async (request, reply) => {
      const { user, settings } = await container.authService.getMe(request.auth!.userId);
      return reply.send(success({ user, settings }, request.id));
    },
  });

  app.patch<{ Body: UpdateProfileBodyInput }>('/users/me', {
    onRequest: [guard],
    handler: async (request, reply) => {
      const body = UpdateProfileBody.parse(request.body);
      const user = await container.authService.updateProfile(request.auth!.userId, body);
      return reply.send(success({ user }, request.id));
    },
  });

  app.delete<{ Body: DeleteAccountBodyInput }>('/users/me', {
    onRequest: [guard],
    handler: async (request, reply) => {
      const body = DeleteAccountBody.parse(request.body);
      await container.authService.deleteAccount(
        request.auth!.userId,
        body.password,
        body.confirmation,
      );
      return reply.send(success({ deleted: true }, request.id));
    },
  });

  app.get('/users/me/settings', {
    onRequest: [guard],
    handler: async (request, reply) => {
      const settings = await container.authService.getMe(request.auth!.userId);
      return reply.send(success({ settings: settings.settings }, request.id));
    },
  });

  app.patch<{ Body: SettingsPatchInput }>('/users/me/settings', {
    onRequest: [guard],
    handler: async (request, reply) => {
      const body = SettingsPatch.parse(request.body);
      const settings = await container.authService.updateSettings(request.auth!.userId, body);
      return reply.send(success({ settings }, request.id));
    },
  });
}
