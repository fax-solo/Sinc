/**
 * App-update state. The latest GitHub release is the single source of truth
 * (there is no backend in the local app). New builds are surfaced three ways:
 * - `softStatus`/`latest`: the "Update available" badge, About screen, and
 *   the dismissible in-app banner.
 * - A once-per-release Android notification (tracked via `remindedFor` so we
 *   never nag about the same build twice, but do remind again for a newer one).
 * - Manual "Check again" in the About & updates screen (always bypasses the
 *   automatic cooldown).
 *
 * Automatic checks run on cold start and when the app returns to foreground,
 * gated by a cooldown so the unauthenticated GitHub API (60 req/hr) is never
 * abused. All failures resolve to a quiet "error" state — update reminders
 * must never disturb playback.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { config } from '../../app/config';
import {
  checkForUpdates,
  UPDATE_CHECK_COOLDOWN_MS,
  type LatestRelease,
} from '../../services/updates/appUpdates';
import { sincNotifications } from '../../services/notifications';
import { STORAGE_KEYS, storage } from '../../utils/storage';

export type SoftUpdateStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'error';

interface UpdateState {
  /** True once at least one check has completed (boot is no longer blocked on it). */
  checked: boolean;
  latest: LatestRelease | null;
  softStatus: SoftUpdateStatus;
  /** Latest release version we have already pushed a notification for. */
  remindedFor: string | null;
  /** Latest release version whose in-app banner the user dismissed. */
  bannerDismissedFor: string | null;
  /** Timestamp of the last automatic check, for the cooldown. */
  lastCheckAt: number | null;
  /** Automatic check; only runs while the cooldown has elapsed unless forced. */
  check: (opts?: { force?: boolean }) => Promise<void>;
  /** Manual check from the About screen; always runs, never double-fires. */
  checkSoft: () => Promise<void>;
  dismissBanner: () => void;
}

export const useUpdateStore = create<UpdateState>()(
  persist(
    (set, get) => {
      const applyCheck = async (): Promise<void> => {
        const result = await checkForUpdates();
        const latest = result.latest;
        set({
          latest,
          softStatus: latest ? (result.available ? 'available' : 'up-to-date') : 'error',
        });
        if (result.available && latest && get().remindedFor !== latest.versionName) {
          set({ remindedFor: latest.versionName });
          void sincNotifications.showUpdateAvailable(
            latest.versionName,
            config.githubReleasePageUrl
          );
        }
      };

      return {
        checked: false,
        latest: null,
        softStatus: 'idle',
        remindedFor: null,
        bannerDismissedFor: null,
        lastCheckAt: null,

        check: async ({ force = false } = {}) => {
          if (get().softStatus === 'checking') return;
          const { lastCheckAt } = get();
          if (!force && lastCheckAt && Date.now() - lastCheckAt < UPDATE_CHECK_COOLDOWN_MS) {
            return;
          }
          set({ checked: true, softStatus: 'checking' });
          await applyCheck();
          set({ lastCheckAt: Date.now() });
        },

        checkSoft: async () => {
          if (get().softStatus === 'checking') return;
          set({ checked: true, softStatus: 'checking' });
          await applyCheck();
        },

        dismissBanner: () => {
          const latest = get().latest;
          if (latest) set({ bannerDismissedFor: latest.versionName });
        },
      };
    },
    {
      name: STORAGE_KEYS.UPDATES,
      storage: createJSONStorage(() => ({
        getItem: (key) => storage.getString(key),
        setItem: (key, value) => storage.setString(key, value),
        removeItem: (key) => storage.remove(key),
      })),
      // Survives restarts so we don't re-notify/re-banner the same release and
      // keep the check cooldown across sessions.
      partialize: (state) => ({
        remindedFor: state.remindedFor,
        bannerDismissedFor: state.bannerDismissedFor,
        lastCheckAt: state.lastCheckAt,
      }),
    }
  )
);
