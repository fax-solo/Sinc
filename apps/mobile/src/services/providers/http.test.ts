import { beforeEach, describe, expect, it, vi } from 'vitest';

const { nativeGet } = vi.hoisted(() => ({ nativeGet: vi.fn() }));

vi.mock('../native', () => ({
  nativeBridge: {
    http: {
      available: () => true,
      get: nativeGet,
    },
  },
}));

import { providerFetchJson } from './http';

describe('provider http bridge', () => {
  beforeEach(() => {
    nativeGet.mockReset();
  });

  it('passes the caller timeout through to the native request', async () => {
    nativeGet.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ ok: true }),
      contentType: 'application/json',
    });

    await expect(
      providerFetchJson('https://example.test/search', undefined, 1234)
    ).resolves.toEqual({ ok: true });
    expect(nativeGet).toHaveBeenCalledWith(
      'https://example.test/search',
      'Sinc/1.0 (music player)',
      undefined,
      1234
    );
  });

  it('surfaces non-2xx responses as provider errors with their status', async () => {
    nativeGet.mockResolvedValueOnce({
      status: 503,
      body: 'busy',
      contentType: 'text/plain',
    });

    await expect(providerFetchJson('https://example.test/search')).rejects.toMatchObject({
      name: 'ProviderError',
      status: 503,
    });
  });
});
