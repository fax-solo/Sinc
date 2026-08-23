import type { Env } from '../config/env.js';

/**
 * Sentry integration point (M9.1). The SDK is intentionally NOT a hard
 * dependency: when SENTRY_DSN is unset this is a no-op. When set, the SDK is
 * loaded lazily and initialized; if the package is missing, a warning is logged
 * and the app keeps running. Install with:
 *
 *   npm i @sentry/node
 *
 * and set SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project> to enable
 * crash + error reporting.
 */
export async function initObservability(env: Env): Promise<void> {
  if (!env.SENTRY_DSN) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@sentry/node') as
      | { init?: (opts: { dsn?: string; environment?: string; tracesSampleRate?: number }) => void }
      | undefined;
    if (!mod?.init) {
      console.warn('[observability] SENTRY_DSN is set but @sentry/node is not installed');
      return;
    }
    mod.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: 0.1,
    });
    console.info('[observability] Sentry initialized');
  } catch (err) {
    console.warn('[observability] Failed to initialize Sentry', err);
  }
}
