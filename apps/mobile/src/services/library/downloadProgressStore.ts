/**
 * Transient download progress, keyed by jobId. Kept outside the persisted
 * downloads store so 250ms progress ticks never trigger a full-downloads
 * JSON.stringify + MMKV write. Persisted records keep their own `progress`
 * field which is updated only on phase transitions.
 */
import { create } from 'zustand';

interface DownloadProgressState {
  progress: Record<string, number>;
  /** True when the server did not provide a total size. */
  indeterminate: Record<string, boolean>;
  /** Human-readable live rate per job, e.g. "214 KiB/s". Absent when unknown. */
  speeds: Record<string, string>;
  setProgress: (jobId: string, progress: number) => void;
  setIndeterminate: (jobId: string, indeterminate: boolean) => void;
  setSpeed: (jobId: string, speed: string | null | undefined) => void;
  clearProgress: (jobId: string) => void;
  clear: () => void;
}

export const useDownloadProgressStore = create<DownloadProgressState>()((set) => ({
  progress: {},
  indeterminate: {},
  speeds: {},
  setProgress: (jobId, progress) =>
    set((state) => {
      const hadIndeterminate = jobId in state.indeterminate;
      if (!hadIndeterminate && state.progress[jobId] === progress) return state;
      const indeterminate = { ...state.indeterminate };
      delete indeterminate[jobId];
      return hadIndeterminate
        ? { progress: { ...state.progress, [jobId]: progress }, indeterminate }
        : { progress: { ...state.progress, [jobId]: progress } };
    }),
  setIndeterminate: (jobId, value) =>
    set((state) => {
      const current = state.indeterminate[jobId] === true;
      if (current === value) return state;
      if (!value) {
        if (!(jobId in state.indeterminate)) return state;
        const indeterminate = { ...state.indeterminate };
        delete indeterminate[jobId];
        return { indeterminate };
      }
      return { indeterminate: { ...state.indeterminate, [jobId]: true } };
    }),
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
      if (
        !(jobId in state.progress) &&
        !(jobId in state.indeterminate) &&
        !(jobId in state.speeds)
      ) {
        return state;
      }
      const progress = { ...state.progress };
      const indeterminate = { ...state.indeterminate };
      const speeds = { ...state.speeds };
      delete progress[jobId];
      delete indeterminate[jobId];
      delete speeds[jobId];
      return { progress, indeterminate, speeds };
    }),
  clear: () => set({ progress: {}, indeterminate: {}, speeds: {} }),
}));
