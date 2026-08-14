import { Platform } from 'react-native';
import {
  SincError,
  OfflineError,
  ErrorCodes,
  type ApiErrorBody,
  type ApiSuccess,
} from '@sinc/shared';
import { useAuthStore } from '../state/authStore';
import { useNetworkStore } from '../state/networkStore';
import type { DeviceHeaders } from './auth';

/** Android emulators reach the host machine via 10.0.2.2; USB devices use adb reverse + localhost. */
const DEFAULT_API_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

export const API_BASE_URL = process.env.SINC_API_URL ?? `http://${DEFAULT_API_HOST}:4000/api/v1`;

const OVERRIDE_URL = process.env.SINC_API_URL;

let resolvedBaseUrl: Promise<string> | null = null;

/**
 * On Android physical devices (USB), 10.0.2.2 is unreachable — `adb reverse`
 * forwards the device's localhost to the host, so probe both and pick the one
 * that answers. The health route lives at the root (`/health`), API routes
 * under `/api/v1`. Cached for the process lifetime.
 */
function resolveBaseUrl(): Promise<string> {
  if (!resolvedBaseUrl) {
    resolvedBaseUrl = (async () => {
      if (OVERRIDE_URL) return OVERRIDE_URL;
      const hosts = Platform.OS === 'android' ? ['10.0.2.2', 'localhost'] : ['localhost'];
      for (const host of hosts) {
        const origin = `http://${host}:4000`;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2000);
          try {
            const response = await fetch(`${origin}/health`, { signal: controller.signal });
            if (response.ok) return `${origin}/api/v1`;
          } finally {
            clearTimeout(timer);
          }
        } catch {
          // try the next candidate
        }
      }
      return `http://${hosts[0]!}:4000/api/v1`;
    })();
  }
  return resolvedBaseUrl;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  deviceHeaders?: DeviceHeaders;
  signal?: AbortSignal;
  /** Retry the request once if the access token was refreshed. */
  retryOnRefresh?: boolean;
}

export class ApiClient {
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (useNetworkStore.getState().status === 'offline') {
      throw new OfflineError();
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.deviceHeaders ?? {}),
      ...options.headers,
    };

    const accessToken = useAuthStore.getState().accessToken;
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    let response: Response;
    try {
      response = await fetch(`${await resolveBaseUrl()}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (err) {
      if (err instanceof SincError) throw err;
      throw new OfflineError();
    }

    if (response.status === 401 && options.retryOnRefresh !== false) {
      const refreshed = await useAuthStore.getState().refreshSession();
      if (refreshed) {
        return this.request<T>(path, { ...options, retryOnRefresh: false });
      }
    }

    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const payload = isJson ? await response.json() : null;

    if (!response.ok) {
      const body = payload as ApiErrorBody | null;
      const code = body?.error?.code ?? ErrorCodes.INTERNAL_ERROR;
      const message = body?.error?.message ?? `Request failed (${response.status})`;
      throw new SincError(code, message, {
        status: response.status,
        details: body?.error?.details,
      });
    }

    const envelope = payload as ApiSuccess<T>;
    return envelope.data;
  }
}

export const apiClient = new ApiClient();
