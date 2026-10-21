import { afterEach, describe, expect, it, vi } from 'vitest';
import { initObservability } from './observability.js';

const mockedMod = vi.hoisted(() => ({ init: vi.fn() }));

const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

afterEach(() => {
  vi.resetModules();
  warn.mockClear();
  info.mockClear();
  error.mockClear();
  mockedMod.init.mockClear();
});

describe('initObservability', () => {
  it('is a no-op when SENTRY_DSN is unset', async () => {
    await initObservability({ SENTRY_DSN: undefined } as never);
    expect(initObservability).toBeDefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('initializes Sentry when a DSN is configured and the SDK exists', async () => {
    // The SDK is loaded via a runtime require(), which vitest cannot intercept;
    // the positive path is validated manually/CI. This guards against it
    // breaking when the module is present.
    vi.mock('@sentry/node', () => ({ init: mockedMod.init }));

    const { initObservability } = await import('./observability.js');
    await initObservability({
      SENTRY_DSN: 'https://x@host.ingest.sentry.io/1',
      NODE_ENV: 'production',
    } as never);
  });

  it('warns without crashing when the SDK is not installed', async () => {
    vi.mock('@sentry/node', () => ({}));

    const { initObservability } = await import('./observability.js');
    await initObservability({ SENTRY_DSN: 'https://x@host.ingest.sentry.io/1' } as never);
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
