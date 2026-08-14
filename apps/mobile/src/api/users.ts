import type { PublicUser } from '@sinc/shared';
import { apiClient } from './client';

export interface UserWithSettings {
  user: PublicUser & { email?: string; status?: string; lastLoginAt?: string | null };
  settings: Record<string, Record<string, unknown>>;
}

export interface UpdateProfileInput {
  displayName?: string;
  username?: string;
  avatarUrl?: string | null;
  locale?: string;
}

export const usersApi = {
  async me(): Promise<UserWithSettings> {
    return apiClient.request<UserWithSettings>('/users/me');
  },

  async updateProfile(patch: UpdateProfileInput): Promise<{ user: UserWithSettings['user'] }> {
    return apiClient.request<{ user: UserWithSettings['user'] }>('/users/me', {
      method: 'PATCH',
      body: patch,
    });
  },

  async getSettings(): Promise<{ settings: UserWithSettings['settings'] }> {
    return apiClient.request<{ settings: UserWithSettings['settings'] }>('/users/me/settings');
  },

  async updateSettings(
    patch: Partial<UserWithSettings['settings']>,
  ): Promise<{ settings: UserWithSettings['settings'] }> {
    return apiClient.request<{ settings: UserWithSettings['settings'] }>('/users/me/settings', {
      method: 'PATCH',
      body: patch,
    });
  },

  async deleteAccount(password: string): Promise<void> {
    await apiClient.request<{ deleted: boolean }>('/users/me', {
      method: 'DELETE',
      body: { password, confirmation: 'DELETE' },
    });
  },

  async listSessions(): Promise<{
    sessions: Array<{ id: string; deviceId: string; isCurrent: boolean; lastUsedAt: string }>;
  }> {
    return apiClient.request('/auth/sessions');
  },

  async revokeAllSessions(): Promise<void> {
    await apiClient.request<{ revokedAll: boolean }>('/auth/sessions', {
      method: 'DELETE',
    });
  },
};
