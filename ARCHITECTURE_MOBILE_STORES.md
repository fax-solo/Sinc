# Mobile Architecture - Global Stores

## Auth Store

```typescript
// stores/authStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { SecureStorage } from '@/native/SecureStorage';

interface User {
  id: string;
  email: string;
  username: string;
  avatarUrl?: string;
  role: 'USER' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN';
  createdAt: string;
  settings: UserSettings;
}

interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  compactMode: boolean;
  reducedMotion: boolean;
  playback: PlaybackSettings;
  downloads: DownloadSettings;
  lyrics: LyricsSettings;
  notifications: NotificationPreferences;
  privacy: PrivacySettings;
  security: SecuritySettings;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Actions
  login: (credentials: { email: string; password: string }) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<void>;
  setUser: (user: User) => void;
  updateSettings: (settings: Partial<UserSettings>) => Promise<void>;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: true,

      login: async (credentials) => {
        set({ isLoading: true });
        try {
          const response = await api.auth.login(credentials);
          await SecureStorage.set('access_token', response.accessToken);
          await SecureStorage.set('refresh_token', response.refreshToken);
          set({
            user: response.user,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      logout: async () => {
        try {
          await api.auth.logout();
        } finally {
          await SecureStorage.delete('access_token');
          await SecureStorage.delete('refresh_token');
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
          });
        }
      },

      refreshAccessToken: async () => {
        const refreshToken = get().refreshToken;
        if (!refreshToken) throw new Error('No refresh token');

        try {
          const response = await api.auth.refresh(refreshToken);
          await SecureStorage.set('access_token', response.accessToken);
          await SecureStorage.set('refresh_token', response.refreshToken);
          set({
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
          });
        } catch (error) {
          get().logout();
          throw error;
        }
      },

      setUser: (user) => set({ user }),

      updateSettings: async (settings) => {
        const user = get().user;
        if (!user) return;
        const updatedUser = { ...user, settings: { ...user.settings, ...settings } };
        set({ user: updatedUser });
        await api.user.updateSettings(settings);
      },

      setBiometricEnabled: async (enabled) => {
        await SecureStorage.set('biometric_enabled', String(enabled));
        get().updateSettings({
          security: { ...get().user?.settings.security, biometricEnabled: enabled },
        });
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => SecureStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
```

## Playback Store

```typescript
// stores/playbackStore.ts
import { create } from 'zustand';
import { AudioPlayer } from '@/native/AudioPlayer';

export type PlaybackStateMachine =
  'IDLE' | 'LOADING' | 'BUFFERING' | 'PLAYING' | 'PAUSED' | 'ENDED' | 'ERROR';

export type ShuffleMode = 'OFF' | 'ON' | 'SMART';
export type RepeatMode = 'OFF' | 'ONE' | 'ALL';
export type PlaybackSourceType = 'LOCAL' | 'REMOTE' | 'CACHED';

interface QueuedTrack {
  id: string;
  track: Track;
  source: PlaybackSource;
}

interface PlaybackSource {
  type: PlaybackSourceType;
  uri: string;
  headers?: Record<string, string>;
  mimeType?: string;
}

interface PlaybackState {
  currentTrack: Track | null;
  currentSource: PlaybackSource | null;
  queue: QueuedTrack[];
  queueIndex: number;
  state: PlaybackStateMachine;
  position: number;
  duration: number;
  shuffle: ShuffleMode;
  repeat: RepeatMode;
  volume: number;
  rate: number;
  error: PlaybackError | null;
  isBuffering: boolean;

  // Actions
  play: (track: Track, queue?: Track[], startIndex?: number) => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  seek: (position: number) => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  setQueue: (tracks: Track[], startIndex?: number) => Promise<void>;
  reorderQueue: (from: number, to: number) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  setShuffle: (mode: ShuffleMode) => void;
  setRepeat: (mode: RepeatMode) => void;
  setVolume: (volume: number) => Promise<void>;
  setRate: (rate: number) => Promise<void>;
  handleStateChange: (state: PlaybackStateMachine) => void;
  handlePositionChange: (position: number) => void;
  handleTrackChange: (track: Track | null, source: PlaybackSource | null) => void;
  handleError: (error: PlaybackError) => void;
  handleBuffering: (isBuffering: boolean) => void;
  restoreState: () => Promise<void>;
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  currentTrack: null,
  currentSource: null,
  queue: [],
  queueIndex: -1,
  state: 'IDLE',
  position: 0,
  duration: 0,
  shuffle: 'OFF',
  repeat: 'OFF',
  volume: 1,
  rate: 1,
  error: null,
  isBuffering: false,

  play: async (track, queue = [], startIndex = 0) => {
    const tracks = queue.length > 0 ? queue : [track];
    const index = queue.length > 0 ? startIndex : 0;

    const source = await SourceResolver.resolve(track);
    if (!source) throw new Error('No playable source found');

    const queuedTracks: QueuedTrack[] = await Promise.all(
      tracks.map((t) =>
        SourceResolver.resolve(t).then((s) => ({ id: t.id, track: t, source: s! })),
      ),
    );

    set({
      queue: queuedTracks,
      queueIndex: index,
      currentTrack: tracks[index],
      currentSource: source,
      state: 'LOADING',
    });

    await AudioPlayer.load(source);
    await AudioPlayer.play();
  },

  pause: async () => {
    await AudioPlayer.pause();
    set({ state: 'PAUSED' });
  },

  stop: async () => {
    await AudioPlayer.stop();
    set({
      state: 'IDLE',
      currentTrack: null,
      currentSource: null,
      position: 0,
      duration: 0,
    });
  },

  seek: async (position) => {
    await AudioPlayer.seek(position);
    set({ position });
  },

  next: async () => {
    const { queue, queueIndex, repeat, shuffle } = get();
    if (queue.length === 0) return;

    let nextIndex = queueIndex + 1;

    if (shuffle === 'ON') {
      nextIndex = Math.floor(Math.random() * queue.length);
    } else if (nextIndex >= queue.length) {
      if (repeat === 'ALL') {
        nextIndex = 0;
      } else {
        get().stop();
        return;
      }
    }

    const nextTrack = queue[nextIndex];
    set({ queueIndex: nextIndex, state: 'LOADING' });
    await AudioPlayer.load(nextTrack.source);
    await AudioPlayer.play();
  },

  previous: async () => {
    const { queue, queueIndex, position } = get();
    if (queue.length === 0) return;

    // If past 3 seconds, restart current track
    if (position > 3000) {
      await AudioPlayer.seek(0);
      return;
    }

    let prevIndex = queueIndex - 1;
    if (prevIndex < 0) prevIndex = queue.length - 1;

    const prevTrack = queue[prevIndex];
    set({ queueIndex: prevIndex, state: 'LOADING' });
    await AudioPlayer.load(prevTrack.source);
    await AudioPlayer.play();
  },

  setQueue: async (tracks, startIndex = 0) => {
    const queuedTracks: QueuedTrack[] = await Promise.all(
      tracks.map((t) =>
        SourceResolver.resolve(t).then((s) => ({ id: t.id, track: t, source: s! })),
      ),
    );
    set({ queue: queuedTracks, queueIndex: startIndex });

    if (tracks[startIndex]) {
      get().play(tracks[startIndex], tracks, startIndex);
    }
  },

  reorderQueue: (from, to) => {
    const { queue } = get();
    const newQueue = [...queue];
    const [removed] = newQueue.splice(from, 1);
    newQueue.splice(to, 0, removed);
    set({ queue: newQueue });
    AudioPlayer.setQueue(newQueue);
  },

  removeFromQueue: (index) => {
    const { queue, queueIndex } = get();
    const newQueue = queue.filter((_, i) => i !== index);
    let newIndex = queueIndex;
    if (index < queueIndex) newIndex--;
    else if (index === queueIndex) newIndex = Math.min(queueIndex, newQueue.length - 1);
    set({ queue: newQueue, queueIndex: newIndex });
    AudioPlayer.setQueue(newQueue);
  },

  clearQueue: () => set({ queue: [], queueIndex: -1 }),

  setShuffle: (mode) => set({ shuffle: mode }),
  setRepeat: (mode) => set({ repeat: mode }),

  setVolume: async (volume) => {
    await AudioPlayer.setVolume(volume);
    set({ volume });
  },

  setRate: async (rate) => {
    await AudioPlayer.setRate(rate);
    set({ rate });
  },

  handleStateChange: (state) => set({ state }),
  handlePositionChange: (position) => set({ position }),
  handleTrackChange: (track, source) => set({ currentTrack: track, currentSource: source }),
  handleError: (error) => set({ state: 'ERROR', error }),
  handleBuffering: (isBuffering) =>
    set({ isBuffering, state: isBuffering ? 'BUFFERING' : 'PLAYING' }),

  restoreState: async () => {
    const state = await AudioPlayer.getState();
    if (state.currentTrack) {
      set({
        currentTrack: state.currentTrack,
        currentSource: state.currentSource,
        queue: state.queue,
        queueIndex: state.queueIndex,
        state: state.state,
        position: state.position,
        duration: state.duration,
        shuffle: state.shuffle,
        repeat: state.repeat,
        volume: state.volume,
        rate: state.rate,
      });
    }
  },
}));
```

## Download Store

```typescript
// stores/downloadStore.ts
import { create } from 'zustand';
import { DownloadManager } from '@/native/DownloadManager';

export type DownloadStatus =
  | 'QUEUED'
  | 'RESOLVING'
  | 'DOWNLOADING'
  | 'PROCESSING'
  | 'FETCHING_LYRICS'
  | 'FINALIZING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'PAUSED'
  | 'EXPIRED';

interface DownloadJob {
  id: string;
  trackId: string;
  status: DownloadStatus;
  progress: number; // 0-100
  bytesDownloaded: number;
  bytesTotal: number;
  speed: number; // bytes/sec
  retryCount: number;
  errorMessage?: string;
  sourceProvider?: string;
  sourceUrl?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  priority: number;
  localPath?: string;
  artworkPath?: string;
  lyricsPath?: string;
}

interface DownloadProgress {
  bytesDownloaded: number;
  bytesTotal: number;
  speed: number;
  percent: number;
}

interface DownloadState {
  jobs: Map<string, DownloadJob>;
  queue: string[]; // Job IDs in order
  activeCount: number;
  maxConcurrent: number;
  wifiOnly: boolean;
  mobileDataAllowed: boolean;

  // Actions
  enqueue: (request: DownloadRequest) => string;
  pause: (jobId: string) => Promise<void>;
  resume: (jobId: string) => Promise<void>;
  cancel: (jobId: string) => Promise<void>;
  retry: (jobId: string) => Promise<void>;
  prioritize: (jobId: string) => void;
  remove: (jobId: string) => void;
  clearCompleted: () => void;
  clearFailed: () => void;
  updateProgress: (jobId: string, progress: DownloadProgress) => void;
  updateStatus: (jobId: string, status: DownloadStatus) => void;
  setMaxConcurrent: (count: number) => Promise<void>;
  setWiFiOnly: (enabled: boolean) => Promise<void>;
  setMobileDataAllowed: (allowed: boolean) => Promise<void>;
  initialize: () => Promise<void>;
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  jobs: new Map(),
  queue: [],
  activeCount: 0,
  maxConcurrent: 3,
  wifiOnly: true,
  mobileDataAllowed: false,

  enqueue: (request) => {
    const jobId = `dl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const job: DownloadJob = {
      id: jobId,
      trackId: request.trackId,
      status: 'QUEUED',
      progress: 0,
      bytesDownloaded: 0,
      bytesTotal: 0,
      speed: 0,
      retryCount: 0,
      createdAt: Date.now(),
      priority: request.priority || 50,
    };

    set((state) => {
      const newJobs = new Map(state.jobs);
      newJobs.set(jobId, job);
      return {
        jobs: newJobs,
        queue: [...state.queue, jobId],
      };
    });

    DownloadManager.enqueue({ ...request, jobId });
    get().processQueue();
    return jobId;
  },

  pause: async (jobId) => {
    const job = get().jobs.get(jobId);
    if (!job || job.status !== 'DOWNLOADING') return;

    await DownloadManager.pause(jobId);
    get().updateStatus(jobId, 'PAUSED');
  },

  resume: async (jobId) => {
    const job = get().jobs.get(jobId);
    if (!job || job.status !== 'PAUSED') return;

    await DownloadManager.resume(jobId);
    get().updateStatus(jobId, 'QUEUED');
    get().processQueue();
  },

  cancel: async (jobId) => {
    await DownloadManager.cancel(jobId);
    get().updateStatus(jobId, 'CANCELLED');
    get().processQueue();
  },

  retry: async (jobId) => {
    const job = get().jobs.get(jobId);
    if (!job || !['FAILED', 'CANCELLED', 'EXPIRED'].includes(job.status)) return;

    const newJob: DownloadJob = {
      ...job,
      id: `dl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      status: 'QUEUED',
      progress: 0,
      bytesDownloaded: 0,
      bytesTotal: 0,
      speed: 0,
      retryCount: job.retryCount + 1,
      errorMessage: undefined,
      createdAt: Date.now(),
    };

    set((state) => {
      const newJobs = new Map(state.jobs);
      newJobs.delete(jobId);
      newJobs.set(newJob.id, newJob);
      return {
        jobs: newJobs,
        queue: state.queue.filter((id) => id !== jobId).concat(newJob.id),
      };
    });

    DownloadManager.enqueue({
      jobId: newJob.id,
      trackId: job.trackId,
      url: job.sourceUrl!,
      destinationPath: getDownloadPath(job.trackId),
      priority: job.priority,
      requiresWiFi: get().wifiOnly,
      allowsCellular: get().mobileDataAllowed,
      metadata: { title: '', artist: '' }, // Will be filled by worker
    });

    get().processQueue();
  },

  prioritize: (jobId) => {
    set((state) => {
      const queue = [...state.queue];
      const index = queue.indexOf(jobId);
      if (index === -1) return state;
      queue.splice(index, 1);
      queue.unshift(jobId);
      return { queue };
    });
    get().processQueue();
  },

  remove: (jobId) => {
    set((state) => {
      const newJobs = new Map(state.jobs);
      newJobs.delete(jobId);
      return {
        jobs: newJobs,
        queue: state.queue.filter((id) => id !== jobId),
      };
    });
  },

  clearCompleted: () => {
    set((state) => {
      const newJobs = new Map(state.jobs);
      const newQueue = [];
      newJobs.forEach((job, id) => {
        if (job.status !== 'COMPLETED') newQueue.push(id);
        else newJobs.delete(id);
      });
      return { jobs: newJobs, queue: newQueue };
    });
  },

  clearFailed: () => {
    set((state) => {
      const newJobs = new Map(state.jobs);
      const newQueue = [];
      newJobs.forEach((job, id) => {
        if (job.status !== 'FAILED') newQueue.push(id);
        else newJobs.delete(id);
      });
      return { jobs: newJobs, queue: newQueue };
    });
  },

  updateProgress: (jobId, progress) => {
    set((state) => {
      const job = state.jobs.get(jobId);
      if (!job) return state;
      const newJobs = new Map(state.jobs);
      newJobs.set(jobId, {
        ...job,
        ...progress,
        status: 'DOWNLOADING',
        startedAt: job.startedAt || Date.now(),
      });
      return { jobs: newJobs };
    });
  },

  updateStatus: (jobId, status) => {
    set((state) => {
      const job = state.jobs.get(jobId);
      if (!job) return state;
      const newJobs = new Map(state.jobs);
      newJobs.set(jobId, {
        ...job,
        status,
        completedAt: ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) ? Date.now() : undefined,
        activeCount:
          status === 'DOWNLOADING'
            ? state.activeCount + 1
            : ['COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED'].includes(status)
              ? state.activeCount - 1
              : state.activeCount,
      });
      return { jobs: newJobs, activeCount: newJobs.get(jobId)?.activeCount ?? state.activeCount };
    });
    get().processQueue();
  },

  setMaxConcurrent: async (count) => {
    await DownloadManager.setMaxConcurrent(count);
    set({ maxConcurrent: count });
    get().processQueue();
  },

  setWiFiOnly: async (enabled) => {
    await DownloadManager.setWiFiOnly(enabled);
    set({ wifiOnly: enabled });
  },

  setMobileDataAllowed: async (allowed) => {
    await DownloadManager.setMobileDataAllowed(allowed);
    set({ mobileDataAllowed: allowed });
  },

  initialize: async () => {
    const jobs = await DownloadManager.getAllJobs();
    const jobMap = new Map();
    const queue: string[] = [];

    jobs.forEach((job) => {
      jobMap.set(job.id, job);
      if (
        [
          'QUEUED',
          'RESOLVING',
          'DOWNLOADING',
          'PROCESSING',
          'FETCHING_LYRICS',
          'FINALIZING',
          'PAUSED',
        ].includes(job.status)
      ) {
        queue.push(job.id);
      }
    });

    set({
      jobs: jobMap,
      queue,
      activeCount: jobs.filter((j) => j.status === 'DOWNLOADING').length,
    });
    get().processQueue();
  },

  processQueue: () => {
    const { queue, activeCount, maxConcurrent, jobs } = get();
    const availableSlots = maxConcurrent - activeCount;

    if (availableSlots <= 0) return;

    const queuedJobs = queue
      .map((id) => jobs.get(id))
      .filter((j): j is DownloadJob => j !== undefined && j.status === 'QUEUED')
      .sort((a, b) => b.priority - a.priority)
      .slice(0, availableSlots);

    queuedJobs.forEach((job) => {
      get().updateStatus(job.id, 'RESOLVING');
      // Trigger backend to resolve source and start download
      api.downloads.start(job.id);
    });
  },
}));

function getDownloadPath(trackId: string): string {
  return `${RNFS.DocumentDirectoryPath}/downloads/${trackId}.m4a`;
}
```

## Network Store

```typescript
// stores/networkStore.ts
import { create } from 'zustand';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

interface NetworkState {
  isOnline: boolean;
  connectionType: 'wifi' | 'cellular' | 'ethernet' | 'unknown';
  isExpensive: boolean;
  effectiveType: '2g' | '3g' | '4g' | '5g' | 'unknown';
  details: NetInfoState['details'] | null;

  // Actions
  initialize: () => Promise<void>;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  isOnline: true,
  connectionType: 'unknown',
  isExpensive: false,
  effectiveType: 'unknown',
  details: null,

  initialize: async () => {
    const state = await NetInfo.fetch();
    set({
      isOnline: state.isConnected ?? false,
      connectionType:
        state.type === 'wifi'
          ? 'wifi'
          : state.type === 'cellular'
            ? 'cellular'
            : state.type === 'ethernet'
              ? 'ethernet'
              : 'unknown',
      isExpensive: state.details?.isExpensive ?? false,
      effectiveType:
        state.details?.cellularGeneration === '2g'
          ? '2g'
          : state.details?.cellularGeneration === '3g'
            ? '3g'
            : state.details?.cellularGeneration === '4g'
              ? '4g'
              : state.details?.cellularGeneration === '5g'
                ? '5g'
                : 'unknown',
      details: state.details,
    });

    NetInfo.addEventListener((state) => {
      set({
        isOnline: state.isConnected ?? false,
        connectionType:
          state.type === 'wifi'
            ? 'wifi'
            : state.type === 'cellular'
              ? 'cellular'
              : state.type === 'ethernet'
                ? 'ethernet'
                : 'unknown',
        isExpensive: state.details?.isExpensive ?? false,
        effectiveType:
          state.details?.cellularGeneration === '2g'
            ? '2g'
            : state.details?.cellularGeneration === '3g'
              ? '3g'
              : state.details?.cellularGeneration === '4g'
                ? '4g'
                : state.details?.cellularGeneration === '5g'
                  ? '5g'
                  : 'unknown',
        details: state.details,
      });
    });
  },
}));
```

## UI Store

```typescript
// stores/uiStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
  theme: 'light' | 'dark' | 'system';
  compactMode: boolean;
  reducedMotion: boolean;
  sidebarOpen: boolean;
  miniPlayerHeight: number;
  activeModal: string | null;

  // Actions
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setCompactMode: (enabled: boolean) => void;
  setReducedMotion: (enabled: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  setMiniPlayerHeight: (height: number) => void;
  setActiveModal: (modal: string | null) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'system',
      compactMode: false,
      reducedMotion: false,
      sidebarOpen: false,
      miniPlayerHeight: 72,
      activeModal: null,

      setTheme: (theme) => set({ theme }),
      setCompactMode: (compactMode) => set({ compactMode }),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setMiniPlayerHeight: (miniPlayerHeight) => set({ miniPlayerHeight }),
      setActiveModal: (activeModal) => set({ activeModal }),
    }),
    {
      name: 'ui-storage',
    },
  ),
);
```
