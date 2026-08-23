import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(response: Partial<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      ...response,
    })
  );
}

describe('ApiClient', () => {
  it('parses JSON responses', async () => {
    mockFetch({ json: async () => ({ hello: 'world' }) });
    const client = new ApiClient('http://test');
    await expect(client.get<{ hello: string }>('/x')).resolves.toEqual({ hello: 'world' });
  });

  it('POSTs a JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('http://test');
    await client.post<{ id: number }>('/x', { name: 'abc' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test/x');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"abc"}');
  });

  it('throws ApiError with the server message on failure', async () => {
    mockFetch({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Not found' }),
    });
    const client = new ApiClient('http://test');
    await expect(client.get('/x')).rejects.toEqual(new ApiError(404, 'Not found'));
  });

  it('sends the access token as a Bearer header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('http://test');
    client.setAccessToken('at-1');
    await client.get('/me');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer at-1');
  });

  it('refreshes and retries once on 401', async () => {
    let meCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        const path = new URL(url).pathname;
        if (path === '/auth/refresh') {
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        if (path === '/me') {
          meCalls += 1;
          if (meCalls === 1)
            return { ok: false, status: 401, json: async () => ({ message: 'expired' }) };
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
      })
    );

    const client = new ApiClient('http://test');
    client.setRefreshToken('rt-1');
    client.setRefreshHandler(() => Promise.resolve('at-2'));
    await expect(client.get<{ ok: boolean }>('/me')).resolves.toEqual({ ok: true });
    expect(meCalls).toBe(2);
  });

  it('throws ApiError when refresh fails and does not retry', async () => {
    let meCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        const path = new URL(url).pathname;
        if (path === '/me') {
          meCalls += 1;
          return { ok: false, status: 401, json: async () => ({ message: 'expired' }) };
        }
        return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
      })
    );

    const client = new ApiClient('http://test');
    client.setRefreshToken('rt-1');
    client.setRefreshHandler(() => Promise.resolve(null));
    await expect(client.get('/me')).rejects.toBeInstanceOf(ApiError);
    expect(meCalls).toBe(1);
  });
});
