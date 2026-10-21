import { describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';
import { getEnv } from '../../config/env.js';

const { mockHash, mockVerify } = vi.hoisted(() => ({
  mockHash: vi.fn(),
  mockVerify: vi.fn(),
}));

vi.mock('argon2', () => ({
  __esModule: true,
  default: { hash: mockHash, verify: mockVerify },
  hash: mockHash,
  verify: mockVerify,
}));

describe('password hashing', () => {
  it('hashes with the configured argon2 cost parameters', async () => {
    const env = getEnv();
    mockHash.mockResolvedValue('hashed');
    const result = await hashPassword('secret');
    expect(result).toBe('hashed');
    expect(mockHash).toHaveBeenCalledWith('secret', {
      memoryCost: env.ARGON2_MEMORY,
      timeCost: env.ARGON2_TIME,
      parallelism: env.ARGON2_PARALLELISM,
    });
  });

  it('verifies against a stored hash', async () => {
    mockVerify.mockResolvedValue(true);
    expect(await verifyPassword('$argon2id$stored', 'secret')).toBe(true);
    expect(mockVerify).toHaveBeenCalledWith('$argon2id$stored', 'secret');

    mockVerify.mockResolvedValue(false);
    expect(await verifyPassword('$argon2id$stored', 'wrong')).toBe(false);
  });
});
