import { NativeModules } from 'react-native';

/**
 * Notification bridge around the native SincNotifications module. Local
 * notifications are posted from Kotlin so users get reminded about updates
 * even without a backend. Degrades to a no-op when the module is not linked
 * (e.g. in unit tests or before the native side is wired), so callers never
 * need try/catch.
 */

export interface NativeNotificationsModule {
  available(): boolean;
  /** Posts a one-shot "update available" notification; false when denied/no-op. */
  showUpdateAvailable(versionName: string, releaseUrl: string): Promise<boolean>;
}

function createUnavailable(): NativeNotificationsModule {
  return {
    available: () => false,
    showUpdateAvailable: async () => false,
  };
}

function createNotifications(): NativeNotificationsModule {
  const module = NativeModules.SincNotifications;
  if (!module) return createUnavailable();
  return {
    available: () => true,
    showUpdateAvailable: (versionName, releaseUrl) =>
      module.showUpdateAvailable(versionName, releaseUrl),
  };
}

export const sincNotifications: NativeNotificationsModule = createNotifications();
