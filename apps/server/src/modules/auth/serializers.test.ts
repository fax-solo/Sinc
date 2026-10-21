import { describe, expect, it } from 'vitest';
import { toCanonicalUser } from './serializers.js';
import type { User } from '@prisma/client';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    email: 'a@sinc.dev',
    username: 'a_user',
    passwordHash: '$argon2id$secret-hash',
    displayName: null,
    avatarUrl: null,
    role: 'user',
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    settings: {},
    ...overrides,
  } as User;
}

describe('auth serializers', () => {
  it('never leaks the password hash', () => {
    const out = toCanonicalUser(makeUser());
    expect(out).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(out)).not.toContain('secret-hash');
  });

  it('merges stored settings over the defaults', () => {
    const out = toCanonicalUser(makeUser({ settings: { theme: 'light' } }));
    expect(out.settings).toMatchObject({
      theme: 'light',
      playbackQuality: 'high',
      repeatDefault: 'off',
    });
  });

  it('defaults analyticsEnabled to false when nothing is stored', () => {
    const out = toCanonicalUser(makeUser());
    expect(out.settings.analyticsEnabled).toBe(false);
  });

  it('preserves a stored analytics opt-in', () => {
    const out = toCanonicalUser(makeUser({ settings: { analyticsEnabled: true } }));
    expect(out.settings.analyticsEnabled).toBe(true);
  });

  it('maps role, status and timestamps', () => {
    const out = toCanonicalUser(makeUser({ role: 'admin', status: 'suspended' }));
    expect(out.role).toBe('admin');
    expect(out.status).toBe('suspended');
    expect(out.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
