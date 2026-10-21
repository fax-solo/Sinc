import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './service.js';
import type { TokenService } from './tokens.js';

const { mockSessionUpdate, shaHash } = vi.hoisted(() => {
  const sha256 = (input: string) => createHash('sha256').update(input).digest('hex');
  return { mockSessionUpdate: vi.fn(), shaHash: sha256 };
});

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({
        id: 'user-1',
        email: 'u@sinc.dev',
        username: 'user',
        displayName: null,
        role: 'user',
        status: 'active',
        passwordHash: 'hash',
        createdAt: new Date(),
        settings: null,
      })),
    },
    session: {
      findUnique: vi.fn(async () => ({
        id: 'session-1',
        userId: 'user-1',
        refreshToken: shaHash('original-refresh-token'),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000_000),
        userAgent: 'test',
        ipAddress: '127.0.0.1',
      })),
      update: mockSessionUpdate,
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => ({})),
    },
  },
}));

const tokens: TokenService = {
  verifyRefreshToken: vi.fn(async () => ({ sub: 'user-1', sid: 'session-1', type: 'refresh' })),
  createAccessToken: vi.fn(async () => 'access-token'),
  createRefreshToken: vi.fn(async () => 'new-refresh-token'),
} as unknown as TokenService;

beforeEach(() => {
  mockSessionUpdate.mockReset();
  mockSessionUpdate.mockResolvedValue({ id: 'session-1' });
});

describe('AuthService.refresh', () => {
  it('rotates the refresh token and stores the rotated digest on success', async () => {
    mockSessionUpdate.mockResolvedValueOnce({ id: 'session-1' });
    const service = new AuthService(tokens);
    const res = await service.refresh('original-refresh-token');
    expect(res.tokens.refreshToken).toBe('new-refresh-token');
    expect(mockSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          refreshToken: shaHash('new-refresh-token'),
        }),
      })
    );
  });

  it('soft-fails: keeps the original refresh token when the rotation write fails', async () => {
    mockSessionUpdate.mockRejectedValueOnce(new Error('connection reset'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = new AuthService(tokens);
    const res = await service.refresh('original-refresh-token');
    expect(res.tokens.refreshToken).toBe('original-refresh-token');
    expect(res.tokens.accessToken).toBe('access-token');
    consoleSpy.mockRestore();
  });

  it('still refuses a refresh when the stored digest does not match the token', async () => {
    const service = new AuthService(tokens);
    await expect(service.refresh('wrong-token')).rejects.toThrow(
      'Invalid or expired refresh token'
    );
  });
});
