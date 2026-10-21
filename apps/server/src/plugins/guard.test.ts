import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError, AuthorizationError } from '@sinc/shared';
import { adminGuard, authGuard } from './guard.js';

const { mockFindUnique } = vi.hoisted(() => ({ mockFindUnique: vi.fn() }));

vi.mock('../lib/prisma.js', () => ({
  prisma: { session: { findUnique: mockFindUnique } },
}));

const tokenService: { verifyAccessToken: ReturnType<typeof vi.fn> } = {
  verifyAccessToken: vi.fn(),
};

function fakeSession(
  user: { role: string; status: string },
  overrides: Partial<{ revokedAt: Date; expiresAt: Date; userId: string; id: string }> = {}
) {
  return {
    id: 'sess-1',
    userId: 'user-1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user,
    ...overrides,
  };
}

function fakeRequest(headers: Record<string, string | undefined> = {}) {
  return { headers: { authorization: headers.authorization } } as never;
}

beforeEach(() => {
  tokenService.verifyAccessToken.mockReset();
  mockFindUnique.mockReset();
  tokenService.verifyAccessToken.mockResolvedValue({ sub: 'user-1', sid: 'sess-1' });
});

describe('authGuard', () => {
  it('rejects a missing or malformed Authorization header', async () => {
    const guard = authGuard(tokenService as never);
    await expect(guard(fakeRequest(), {} as never)).rejects.toBeInstanceOf(AuthenticationError);
    await expect(
      guard(fakeRequest({ authorization: 'Token abc' }), {} as never)
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects an unverifiable token', async () => {
    tokenService.verifyAccessToken.mockRejectedValue(new Error('bad'));
    await expect(
      authGuard(tokenService as never)(fakeRequest({ authorization: 'Bearer x' }), {} as never)
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects missing, revoked, expired, or mismatched sessions', async () => {
    const guard = authGuard(tokenService as never);
    mockFindUnique.mockResolvedValue(null);
    await expect(
      guard(fakeRequest({ authorization: 'Bearer x' }), {} as never)
    ).rejects.toBeInstanceOf(AuthenticationError);

    mockFindUnique.mockResolvedValue(
      fakeSession({ role: 'user', status: 'active' }, { revokedAt: new Date() })
    );
    await expect(
      guard(fakeRequest({ authorization: 'Bearer x' }), {} as never)
    ).rejects.toBeInstanceOf(AuthenticationError);

    mockFindUnique.mockResolvedValue(
      fakeSession({ role: 'user', status: 'active' }, { expiresAt: new Date(Date.now() - 1) })
    );
    await expect(
      guard(fakeRequest({ authorization: 'Bearer x' }), {} as never)
    ).rejects.toBeInstanceOf(AuthenticationError);

    mockFindUnique.mockResolvedValue(
      fakeSession({ role: 'user', status: 'active' }, { userId: 'someone-else' })
    );
    await expect(
      guard(fakeRequest({ authorization: 'Bearer x' }), {} as never)
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('attaches auth and rejects suspended users by default', async () => {
    const guard = authGuard(tokenService as never);
    mockFindUnique.mockResolvedValue(fakeSession({ role: 'user', status: 'suspended' }));
    await expect(
      guard(fakeRequest({ authorization: 'Bearer x' }), {} as never)
    ).rejects.toBeInstanceOf(AuthorizationError);

    mockFindUnique.mockResolvedValue(fakeSession({ role: 'admin', status: 'active' }));
    const req = fakeRequest({ authorization: 'Bearer x' });
    await guard(req, {} as never);
    expect(req).toMatchObject({
      auth: { userId: 'user-1', sessionId: 'sess-1', role: 'admin', status: 'active' },
    });
  });

  it('allows suspended users when rejectSuspended is false', async () => {
    const guard = authGuard(tokenService as never, { rejectSuspended: false });
    mockFindUnique.mockResolvedValue(fakeSession({ role: 'user', status: 'suspended' }));
    const req = fakeRequest({ authorization: 'Bearer x' });
    await guard(req, {} as never);
    expect(req).toMatchObject({ auth: { status: 'suspended' } });
  });
});

describe('adminGuard', () => {
  it('rejects non-admins and suspended admins', async () => {
    const guard = adminGuard(tokenService as never);
    mockFindUnique.mockResolvedValue(fakeSession({ role: 'user', status: 'active' }));
    await expect(
      guard(fakeRequest({ authorization: 'Bearer x' }), {} as never)
    ).rejects.toBeInstanceOf(AuthorizationError);

    mockFindUnique.mockResolvedValue(fakeSession({ role: 'admin', status: 'suspended' }));
    await expect(
      guard(fakeRequest({ authorization: 'Bearer x' }), {} as never)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('accepts an active admin', async () => {
    mockFindUnique.mockResolvedValue(fakeSession({ role: 'admin', status: 'active' }));
    const req = fakeRequest({ authorization: 'Bearer x' });
    await adminGuard(tokenService as never)(req, {} as never);
    expect(req).toMatchObject({ auth: { role: 'admin' } });
  });
});
