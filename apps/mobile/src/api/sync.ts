import type { SyncApplyResult, SyncMutation, SyncSnapshot } from '@sinc/shared';
import { apiClient } from './client';

export function getSyncSnapshot(): Promise<SyncSnapshot> {
  return apiClient.request<SyncSnapshot>('/sync/snapshot');
}

export function applySyncMutations(mutations: SyncMutation[]): Promise<SyncApplyResult> {
  return apiClient.request<SyncApplyResult>('/sync/apply', {
    method: 'POST',
    body: { mutations },
  });
}
