import type { CanonicalUser } from '@sinc/shared';
import { apiClient } from '../../api/client';
import type { AuthResponse, LoginInput, RegisterInput } from './types';

export const authApi = {
  login(input: LoginInput): Promise<AuthResponse> {
    return apiClient.post<AuthResponse>('/auth/login', input);
  },

  register(input: RegisterInput): Promise<AuthResponse> {
    return apiClient.post<AuthResponse>('/auth/register', input);
  },

  refresh(refreshToken: string): Promise<AuthResponse> {
    return apiClient.post<AuthResponse>('/auth/refresh', { refreshToken });
  },

  logout(refreshToken: string): Promise<{ success: boolean }> {
    return apiClient.post<{ success: boolean }>('/auth/logout', { refreshToken });
  },

  me(): Promise<CanonicalUser> {
    return apiClient.get<CanonicalUser>('/auth/me');
  },
};
