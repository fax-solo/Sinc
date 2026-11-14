import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { storage, STORAGE_KEYS } from '../../utils/storage';

export type NotificationKind = 'update' | 'download' | 'import' | 'system';

export type NotificationAction =
  | { type: 'updates' }
  | { type: 'downloads' }
  | { type: 'playlist'; playlistId: string }
  | { type: 'player' }
  | { type: 'library' };

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  action?: NotificationAction;
}

interface NotificationState {
  notifications: AppNotification[];
  add: (notification: Omit<AppNotification, 'createdAt' | 'read'> & { createdAt?: number }) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
}

const MAX_NOTIFICATIONS = 50;

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: [],

      add: (input) => {
        if (get().notifications.some((item) => item.id === input.id)) return;
        const notification: AppNotification = {
          ...input,
          createdAt: input.createdAt ?? Date.now(),
          read: false,
        };
        set({
          notifications: [notification, ...get().notifications].slice(0, MAX_NOTIFICATIONS),
        });
      },

      markRead: (id) =>
        set({
          notifications: get().notifications.map((item) =>
            item.id === id ? { ...item, read: true } : item
          ),
        }),

      markAllRead: () =>
        set({
          notifications: get().notifications.map((item) =>
            item.read ? item : { ...item, read: true }
          ),
        }),

      remove: (id) =>
        set({ notifications: get().notifications.filter((item) => item.id !== id) }),

      clear: () => set({ notifications: [] }),
    }),
    {
      name: STORAGE_KEYS.NOTIFICATIONS,
      storage: createJSONStorage(() => ({
        getItem: (key) => storage.getString(key),
        setItem: (key, value) => storage.setString(key, value),
        removeItem: (key) => storage.remove(key),
      })),
      version: 1,
      partialize: (state) => ({ notifications: state.notifications }),
    }
  )
);

export function selectUnreadCount(state: NotificationState): number {
  return state.notifications.reduce((count, item) => (item.read ? count : count + 1), 0);
}
