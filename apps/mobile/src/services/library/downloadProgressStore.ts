/**
 * Transient download progress, keyed by jobId. Kept outside the persisted
 * downloads store so 250ms progress ticks never trigger a full-downloads
 * JSON.stringify + MMKV write. Persisted records keep their own `progress`
 * field which is updated only on phase transitions.
 */
import { create } from 'zustand';

interface DownloadProgressState {
  progress: Record<string, number>;
  /** Human-readable live rate per job, e.g. "214 KiB/s". Absent when unknown. */
  speeds: Record<string, string>;
  setProgress: (jobId: string, progress: number) => void;
  setSpeed: (jobId: string, speed: string | null | undefined) => void;
  clearProgress: (jobId: string) => void;
  clear: () => void;
}

export const useDownloadProgressStore = create<DownloadProgressState>()((set) => ({
  progress: {},
  speeds: {},
  setProgress: (jobId, progress) =>
    set((state) =>
      state.progress[jobId] === progress
        ? state
        : { progress: { ...state.progress, [jobId]: progress } }
    ),
  setSpeed: (jobId, speed) =>
    set((state) => {
      if (!speed) {
        if (!(jobId in state.speeds)) return state;
        const next = { ...state.speeds };
        delete next[jobId];
        return { speeds: next };
      }
      return state.speeds[jobId] === speed
        ? state
        : { speeds: { ...state.speeds, [jobId]: speed } };
    }),
  clearProgress: (jobId) =>
    set((state) => {
      if (!(jobId in state.progress) && !(jobId in state.speeds)) return state;
      const progress = { ...state.progress };
      const speeds = { ...state.speeds };
      delete progress[jobId];
      delete speeds[jobId];
      return { progress, speeds };
    }),
  clear: () => set({ progress: {}, speeds: {} }),
}));
