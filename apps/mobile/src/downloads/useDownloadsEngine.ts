import { useEffect } from 'react';
import { getDatabase } from '../db/database';
import { downloadService } from '../downloads/instance';
import { installDownloadsService } from '../downloads/service';
import { useAuthStore } from '../state/authStore';
import { useNetworkStore } from '../state/networkStore';

/**
 * App-level downloads driver (M3.3/M4.2). Installs the native-event bridge
 * once, and reconciles active jobs (resume QUEUED, fail orphaned
 * DOWNLOADING) when the user is authenticated and the network is online:
 * on mount, on (re)authentication and on offline→online transitions.
 */
export function useDownloadsEngine(): void {
  useEffect(() => {
    const unsubscribed = installDownloadsService(getDatabase());
    return () => unsubscribed();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const reconcile = async () => {
      if (!useAuthStore.getState().user) return;
      if (useNetworkStore.getState().status !== 'online') return;
      await downloadService.reconcileDownloads(getDatabase());
    };
    const unsubscribeAuth = useAuthStore.subscribe((current, previous) => {
      if (current.user && !previous.user && !cancelled) void reconcile();
    });
    const unsubscribeNetwork = useNetworkStore.subscribe((current, previous) => {
      if (current.status === 'online' && previous.status !== 'online' && !cancelled) {
        void reconcile();
      }
    });
    const timer = setTimeout(() => void reconcile(), 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribeAuth();
      unsubscribeNetwork();
    };
  }, []);
}
