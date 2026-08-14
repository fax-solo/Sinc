import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabase } from '../db/database';
import { runSync } from '../db/syncService';
import { useAuthStore } from '../state/authStore';
import { useNetworkStore } from '../state/networkStore';

export interface SyncEngineState {
  status: 'idle' | 'syncing' | 'error';
  lastSyncedAt: number | null;
  lastConflictCount: number;
  syncing: boolean;
}

export interface SyncEngine extends SyncEngineState {
  syncNow: () => Promise<void>;
}

const INITIAL: SyncEngineState = {
  status: 'idle',
  lastSyncedAt: null,
  lastConflictCount: 0,
  syncing: false,
};

/**
 * App-level sync driver (M3.2). Runs the sync queue when the user is
 * authenticated and the network is online: on mount, on (re)authentication
 * and on offline→online transitions. Conflicts are resolved server-wins by
 * the engine; this hook only surfaces the latest count for UI purposes.
 */
export function useSyncEngine(): SyncEngine {
  const [state, setState] = useState<SyncEngineState>(INITIAL);
  const runningRef = useRef(false);

  const syncNow = useCallback(async () => {
    if (runningRef.current) return;
    if (!useAuthStore.getState().user) return;
    if (useNetworkStore.getState().status !== 'online') return;
    runningRef.current = true;
    await Promise.resolve();
    setState((current) => ({ ...current, status: 'syncing', syncing: true }));
    try {
      const result = await runSync(getDatabase());
      setState({
        status: 'idle',
        lastSyncedAt: Date.now(),
        lastConflictCount: result.conflicts.length,
        syncing: false,
      });
    } catch {
      setState((current) => ({ ...current, status: 'error', syncing: false }));
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    const unsubscribeAuth = useAuthStore.subscribe((current, previous) => {
      if (current.user && !previous.user) void syncNow();
    });
    const unsubscribeNetwork = useNetworkStore.subscribe((current, previous) => {
      if (current.status === 'online' && previous.status !== 'online') void syncNow();
    });
    const timer = setTimeout(() => void syncNow(), 0);
    return () => {
      clearTimeout(timer);
      unsubscribeAuth();
      unsubscribeNetwork();
    };
  }, [syncNow]);

  return { ...state, syncNow };
}
