import { create } from 'zustand';

export type NetworkStatus = 'online' | 'offline';

interface NetworkState {
  status: NetworkStatus;
  /** True when the last connectivity transition was detected at runtime. */
  isInitialized: boolean;
  setStatus: (status: NetworkStatus) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  status: 'online',
  isInitialized: false,
  setStatus: (status) => set({ status, isInitialized: true }),
}));
