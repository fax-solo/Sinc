import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { storage, STORAGE_KEYS } from '../../utils/storage';

export type NotificationPreference = 'updates' | 'downloads' | 'imports';

interface PreferencesState {
  notifications: Record<NotificationPreference, boolean>;
  setNotificationPreference: (key: NotificationPreference, enabled: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set, get) => ({
      notifications: { updates: true, downloads: true, imports: true },
      setNotificationPreference: (key, enabled) =>
        set({
          notifications: {
            ...get().notifications,
            [key]: enabled,
          },
        }),
    }),
    {
      name: STORAGE_KEYS.UI_PREFS,
      storage: createJSONStorage(() => ({
        getItem: (key) => storage.getString(key),
        setItem: (key, value) => storage.setString(key, value),
        removeItem: (key) => storage.remove(key),
      })),
      version: 1,
      partialize: (state) => ({ notifications: state.notifications }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<{ notifications: Partial<Record<NotificationPreference, boolean>> }>;
        return {
          ...current,
          notifications: {
            ...current.notifications,
            ...(saved.notifications ?? {}),
          },
        };
      },
    }
  )
);
