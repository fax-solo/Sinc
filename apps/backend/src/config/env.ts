import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().default('postgresql://sinc:sinc@localhost:5432/sinc?schema=public'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  /** PEM RSA private key for RS256 access tokens. Ephemeral keypair in dev when absent. */
  JWT_ACCESS_PRIVATE_KEY: z.string().optional(),
  /** PEM RSA public key matching JWT_ACCESS_PRIVATE_KEY. */
  JWT_ACCESS_PUBLIC_KEY: z.string().optional(),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  VERIFY_EMAIL_TTL_HOURS: z.coerce.number().int().positive().default(24),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),

  /** Base URL used when building verification/reset links in emails. */
  APP_BASE_URL: z.string().url().default('http://localhost:4000'),

  /**
   * HMAC secret for signed stream URLs. When absent (dev/demo), an ephemeral
   * secret is generated per boot, invalidating previously issued URLs.
   */
  STREAM_SIGNING_SECRET: z.string().min(16).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
