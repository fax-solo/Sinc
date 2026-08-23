/**
 * Forced-update gate state (M9.3). `check()` runs once per foreground session;
 * if the installed version is below the server minimum the UI renders the
 * blocking UpdateRequiredScreen. Unreachable API => not blocked (offline usage
 * must never be interrupted).
 */
import { create } from 'zustand';
import { checkForcedUpdate, type UpdateStatus } from '../../services/updates/appUpdates';

interface UpdateState {
  checked: boolean;
  blocked: boolean;
  minAppVersion: string;
  check: () => Promise<void>;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  checked: false,
  blocked: false,
  minAppVersion: '',
  check: async () => {
    if (useUpdateStore.getState().checked) return;
    const status: UpdateStatus = await checkForcedUpdate();
    set({ checked: true, blocked: status.blocked, minAppVersion: status.minAppVersion });
  },
}));
