/**
 * App-update state. Two layers:
 * - Forced gate (M9.3): runs once per foreground session; if the installed
 *   version is below the server minimum the UI renders the blocking
 *   UpdateRequiredScreen. Unreachable API => not blocked (offline usage must
 *   never be interrupted).
 * - Soft check: compares against the latest GitHub release and surfaces an
 *   "Update available" state (non-blocking). `checkSoft` powers the manual
 *   "Check again" action in the About & updates screen.
 */
import { create } from 'zustand';
import {
  checkForcedUpdate,
  checkForUpdates,
  type LatestRelease,
  type UpdateStatus,
} from '../../services/updates/appUpdates';

export type SoftUpdateStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'error';

interface UpdateState {
  checked: boolean;
  blocked: boolean;
  minAppVersion: string;
  latest: LatestRelease | null;
  softStatus: SoftUpdateStatus;
  check: () => Promise<void>;
  checkSoft: () => Promise<void>;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  checked: false,
  blocked: false,
  minAppVersion: '',
  latest: null,
  softStatus: 'idle',
  check: async () => {
    if (useUpdateStore.getState().checked) return;
    const status: UpdateStatus = await checkForcedUpdate();
    const soft = await checkForUpdates();
    set({
      checked: true,
      blocked: status.blocked,
      minAppVersion: status.minAppVersion,
      latest: soft.latest,
      softStatus: soft.latest ? (soft.available ? 'available' : 'up-to-date') : 'error',
    });
  },
  checkSoft: async () => {
    if (useUpdateStore.getState().softStatus === 'checking') return;
    set({ softStatus: 'checking' });
    const soft = await checkForUpdates();
    set({
      latest: soft.latest,
      softStatus: soft.latest ? (soft.available ? 'available' : 'up-to-date') : 'error',
    });
  },
}));
