/**
 * Central API client. Every network request in the app flows through this
 * class — screens never call fetch directly. It attaches the access token,
 * and transparently refreshes + retries once when the token is expired.
 */
import { config } from '../app/config';

type JsonRequestInit = Omit<RequestInit, 'body'> & { body?: unknown };

const NO_REFRESH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh'];

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshHandler: (() => Promise<string | null>) | null = null;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(private readonly baseUrl: string) {}

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  setRefreshToken(token: string | null): void {
    this.refreshToken = token;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  setRefreshHandler(handler: (() => Promise<string | null>) | null): void {
    this.refreshHandler = handler;
  }

  async get<T>(path: string, headers?: Record<string, string>, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, { headers, signal });
  }

  async post<T>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
    signal?: AbortSignal
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, headers, signal });
  }

  async patch<T>(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
    signal?: AbortSignal
  ): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, headers, signal });
  }

  async put<T>(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
    signal?: AbortSignal
  ): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, headers, signal });
  }

  async delete<T>(
    path: string,
    headers?: Record<string, string>,
    signal?: AbortSignal
  ): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', headers, signal });
  }

  private async request<T>(path: string, init: JsonRequestInit = {}): Promise<T> {
    let response = await this.doFetch(path, init);

    if (
      response.status === 401 &&
      this.refreshToken &&
      !NO_REFRESH_PATHS.some((p) => path.startsWith(p))
    ) {
      const newAccessToken = await this.attemptRefresh();
      if (newAccessToken) {
        response = await this.doFetch(path, init);
      }
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message =
        (body as { message?: string } | null)?.message ?? `Request failed (${response.status})`;
      throw new ApiError(response.status, message);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async doFetch(path: string, init: JsonRequestInit): Promise<Response> {
    const { body, ...rest } = init;
    const hasBody = body !== undefined && body !== null;
    return fetch(`${this.baseUrl}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        ...(init.headers ?? {}),
      },
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: init.signal,
    });
  }

  private async attemptRefresh(): Promise<string | null> {
    if (!this.refreshHandler) return null;
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshHandler().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }
}

export const apiClient = new ApiClient(config.apiBaseUrl);
