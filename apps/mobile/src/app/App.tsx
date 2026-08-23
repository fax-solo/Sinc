import { useEffect } from 'react';
import { AppState } from 'react-native';
import { AppProviders } from './providers';
import { RootNavigator } from './navigation/RootNavigator';
import { useAuthStore } from '../features/auth/authStore';
import { useLibraryStore } from '../services/library/libraryStore';
import { useLockStore } from '../features/lock/lockStore';
import { syncFavorites } from '../services/library/sync';

/**
 * Root component. Restores the session on boot, then hands off to
 * auth-gated navigation.
 */
export default function App() {
  const status = useAuthStore((s) => s.status);
  const favorites = useLibraryStore((s) => s.favoriteTracks);

  useEffect(() => {
    void useAuthStore.getState().initialize();
  }, []);

  // Re-arm the app lock the moment the app leaves the foreground (M7.3).
  // LockGate in the navigator re-shows the PIN screen on the next return.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        useLockStore.getState().lock();
      }
    });
    return () => subscription.remove();
  }, []);

  // Keep the server's favorites in step with the local store: covers toggles
  // and the initial upload of pre-existing favorites after login/rehydration.
  useEffect(() => {
    if (status !== 'signedIn') return;
    syncFavorites();
  }, [status, favorites]);

  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}
