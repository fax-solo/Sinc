import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  CORS_ORIGIN: z.string().default('*'),

  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  ARGON2_MEMORY: z.coerce.number().default(65536),
  ARGON2_TIME: z.coerce.number().default(3),
  ARGON2_PARALLELISM: z.coerce.number().default(4),

  ITUNES_API_URL: z.string().url().default('https://itunes.apple.com'),
  YTDLP_BINARY: z.string().default('yt-dlp'),
  DOWNLOAD_DIR: z.string().default('./downloads'),

  JAMENDO_CLIENT_ID: z.string().optional(),
  FMA_API_KEY: z.string().optional(),

  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),

  // M9 observability / release readiness.
  SENTRY_DSN: z.string().url().optional(),
  METRICS_ENABLED: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('false'),
  FEATURE_FLAGS: z.string().optional(), // comma-separated "name=on|off" pairs
  MIN_APP_VERSION: z.string().default('0.0.0'),

  // M9.2 abuse protection: global per-IP request cap per minute.
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  RATE_LIMIT_ENABLED: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('true'),
});

export type Env = z.infer<typeof EnvSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

export function getEnv(): Env {
  return cachedEnv ?? loadEnv();
}
