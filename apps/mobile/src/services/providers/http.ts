/**
 * Tiny HTTP helper for third-party provider calls. Every provider request uses
 * `providerFetch`/`providerFetchText` so timeouts and error handling stay
 * uniform. Results are never sent to our own servers.
 *
 * On Android the request goes through the `SincHttp` native bridge: React
 * Native's own networking always stamps `User-Agent: okhttp/4.x`, and
 * Cloudflare-fronted providers (LRCLIB) answer that with HTTP 520, which the
 * bridge avoids by sending the provider's real `User-Agent`. Elsewhere — and in
 * tests — it falls back to the global `fetch`.
 */
import { nativeBridge } from '../native';

const TIMEOUT_MS = 10_000;

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export async function providerFetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs: number = TIMEOUT_MS
): Promise<T> {
  const response = await providerFetch(url, init, timeoutMs);
  return (await response.json()) as T;
}

export async function providerFetchText(
  url: string,
  init?: RequestInit,
  timeoutMs: number = TIMEOUT_MS
): Promise<string> {
  const response = await providerFetch(url, init, timeoutMs);
  return response.text();
}

function headerValue(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (!headers) return undefined;
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return match?.[1];
  }
  const entry = Object.entries(headers as Record<string, string>).find(
    ([key]) => key.toLowerCase() === name.toLowerCase()
  );
  return entry?.[1];
}

const DEFAULT_USER_AGENT = 'Sinc/1.0 (music player)';

async function nativeFetch(url: string, init?: RequestInit): Promise<Response | null> {
  if (!nativeBridge.http?.available()) return null;
  // Route every provider request through the native bridge when linked, even
  // when the caller passed no User-Agent (iTunes/Deezer). Falling back to RN's
  // fetch stamps `okhttp/4.x`, which Cloudflare-fronted APIs answer with 520.
  const userAgent = headerValue(init, 'User-Agent') ?? DEFAULT_USER_AGENT;
  try {
    const result = await nativeBridge.http.get(url, userAgent, headerValue(init, 'Accept'));
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => JSON.parse(result.body) as unknown,
      text: async () => result.body,
    } as Response;
  } catch {
    throw new ProviderError('Provider request failed', 0);
  }
}

async function providerFetch(
  url: string,
  init?: RequestInit,
  timeoutMs: number = TIMEOUT_MS
): Promise<Response> {
  const native = await nativeFetch(url, init);
  if (native) {
    if (!native.ok) {
      throw new ProviderError(`Provider request failed (${native.status})`, native.status);
    }
    return native;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new ProviderError(`Provider request failed (${response.status})`, response.status);
    }
    return response;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError('Provider request failed', 0);
  } finally {
    clearTimeout(timeout);
  }
}
