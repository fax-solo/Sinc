import argon2 from 'argon2';
import { getEnv } from '../../config/env.js';

export function hashPassword(password: string): Promise<string> {
  const env = getEnv();
  return argon2.hash(password, {
    memoryCost: env.ARGON2_MEMORY,
    timeCost: env.ARGON2_TIME,
    parallelism: env.ARGON2_PARALLELISM,
  });
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}
