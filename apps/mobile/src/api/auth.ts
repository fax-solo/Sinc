import type { PublicUser, AuthResult } from '@sinc/shared';
import { apiClient } from './client';
import { getDeviceContext } from '../device';

export interface RegisterInput {
  email: string;
  password: string;
  username: string;
  displayName?: string;
  locale?: string;
}

export interface DeviceHeaders {
  'x-device-id': string;
  'x-platform': string;
}

function deviceHeaders(): DeviceHeaders {
  return getDeviceContext();
}

export const authApi = {
  async register(input: RegisterInput): Promise<AuthResult> {
    return apiClient.request<AuthResult>('/auth/register', {
      method: 'POST',
      body: input,
      deviceHeaders: deviceHeaders(),
    });
  },

  async login(email: string, password: string): Promise<AuthResult> {
    return apiClient.request<AuthResult>('/auth/login', {
      method: 'POST',
      body: { email, password },
      deviceHeaders: deviceHeaders(),
    });
  },

  async refresh(refreshToken: string): Promise<AuthResult> {
    return apiClient.request<AuthResult>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      deviceHeaders: deviceHeaders(),
      retryOnRefresh: false,
    });
  },

  async logout(refreshToken: string): Promise<void> {
    await apiClient.request<{ loggedOut: boolean }>('/auth/logout', {
      method: 'POST',
      body: { refreshToken },
      deviceHeaders: deviceHeaders(),
    });
  },

  async verifyEmail(token: string): Promise<AuthResult> {
    return apiClient.request<AuthResult>('/auth/verify-email', {
      method: 'POST',
      body: { token },
      deviceHeaders: deviceHeaders(),
    });
  },

  async resendVerification(email: string): Promise<void> {
    await apiClient.request<{ sent: boolean }>('/auth/resend-verification', {
      method: 'POST',
      body: { email },
      deviceHeaders: deviceHeaders(),
    });
  },

  async requestPasswordReset(email: string): Promise<void> {
    await apiClient.request<{ sent: boolean }>('/auth/password-reset/request', {
      method: 'POST',
      body: { email },
      deviceHeaders: deviceHeaders(),
    });
  },

  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    await apiClient.request<{ reset: boolean }>('/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, newPassword },
      deviceHeaders: deviceHeaders(),
    });
  },
};

export type { PublicUser };
