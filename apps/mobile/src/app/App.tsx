import { useEffect } from 'react';
import { AppState } from 'react-native';
import { AppProviders } from './providers';
import { RootNavigator } from './navigation/RootNavigator';
import { useLockStore } from '../features/lock/lockStore';
import { useUpdateStore } from '../features/updates/updateStore';

/**
 * Root component. The app boots into the local profile immediately; the only
 * gates are the PIN app-lock and, if the platform needs it, the forced update
 * screen (removed in the local build — updates are reminders only).
 */
export default function App() {
  // Check for a newer release on cold start, then again whenever the app
  // returns to the foreground (bounded by the store's check cooldown).
  useEffect(() => {
    void useUpdateStore.getState().check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void useUpdateStore.getState().check();
      }
    });
    return () => subscription.remove();
  }, []);

  // Re-arm the app lock the moment the app leaves the foreground (M7.3).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        useLockStore.getState().lock();
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}
