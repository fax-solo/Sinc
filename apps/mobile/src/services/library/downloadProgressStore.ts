/**
 * Transient download progress, keyed by jobId. Kept outside the persisted
 * downloads store so 250ms progress ticks never trigger a full-downloads
 * JSON.stringify + MMKV write. Persisted records keep their own `progress`
 * field which is updated only on phase transitions.
 */
import { create } from 'zustand';

interface DownloadProgressState {
  progress: Record<string, number>;
  setProgress: (jobId: string, progress: number) => void;
  clearProgress: (jobId: string) => void;
  clear: () => void;
}

export const useDownloadProgressStore = create<DownloadProgressState>()((set) => ({
  progress: {},
  setProgress: (jobId, progress) =>
    set((state) =>
      state.progress[jobId] === progress
        ? state
        : { progress: { ...state.progress, [jobId]: progress } }
    ),
  clearProgress: (jobId) =>
    set((state) => {
      if (!(jobId in state.progress)) return state;
      const next = { ...state.progress };
      delete next[jobId];
      return { progress: next };
    }),
  clear: () => set({ progress: {} }),
}));
