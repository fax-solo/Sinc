import { create } from 'zustand';
import { AppState, type AppStateStatus } from 'react-native';
import type { CanonicalAlbum, CanonicalArtist, CanonicalTrack } from '@sinc/shared';
import { nativeBridge } from '../native';
import { useLibraryStore, type LocalPlaylist, type PlayStat } from '../library/libraryStore';
import { useDownloadsStore, type DownloadRecord } from '../library/downloadsStore';
import { useAuthStore } from '../../features/auth/authStore';
import { storage, STORAGE_KEYS } from '../../utils/storage';

export const BACKUP_VERSION = 1;

export interface BackupProfile {
  id: string;
  username: string;
  bio?: string;
  avatarUrl?: string;
  settings?: Record<string, unknown>;
  streakDays?: number;
  lastActiveDate?: string;
}

export interface SincBackupPayload {
  version: number;
  createdAt: number;
  profile: BackupProfile;
  favoriteTracks: CanonicalTrack[];
  playlists: LocalPlaylist[];
  playStats: Record<string, PlayStat>;
  artistPlayStats: Record<string, number>;
  skipStats: Record<string, number>;
  recentlyPlayed: CanonicalTrack[];
  followedArtists: CanonicalArtist[];
  followedAlbums: CanonicalAlbum[];
  downloads: DownloadRecord[];
}

export interface BackupState {
  isSaving: boolean;
  isRestoring: boolean;
  lastBackupTime: number | null;
  lastBackupPath: string | null;
  lastBackupSizeBytes: number | null;
  autoBackupEnabled: boolean;
  setLastBackupInfo: (info: { time: number; path: string; sizeBytes: number }) => void;
  setAutoBackupEnabled: (enabled: boolean) => void;
}

const initialBackupInfo = storage.getObject<{
  time: number;
  path: string;
  sizeBytes: number;
}>(STORAGE_KEYS.BACKUP_INFO);

export const useBackupStore = create<BackupState>((set) => ({
  isSaving: false,
  isRestoring: false,
  lastBackupTime: initialBackupInfo?.time ?? null,
  lastBackupPath: initialBackupInfo?.path ?? null,
  lastBackupSizeBytes: initialBackupInfo?.sizeBytes ?? null,
  autoBackupEnabled: true,
  setLastBackupInfo: (info) => {
    storage.setObject(STORAGE_KEYS.BACKUP_INFO, info);
    set({
      lastBackupTime: info.time,
      lastBackupPath: info.path,
      lastBackupSizeBytes: info.sizeBytes,
    });
  },
  setAutoBackupEnabled: (enabled) => set({ autoBackupEnabled: enabled }),
}));

/**
 * Builds the complete state payload ready for serialization and saving.
 */
export function buildBackupPayload(): SincBackupPayload {
  const library = useLibraryStore.getState();
  const downloadsState = useDownloadsStore.getState();
  const auth = useAuthStore.getState();

  // Load custom profile details from storage if present
  const storedProfile = storage.getObject<Partial<BackupProfile>>(STORAGE_KEYS.PROFILE) ?? {};

  const profile: BackupProfile = {
    id: auth.user?.id ?? 'local',
    username: storedProfile.username ?? auth.user?.username ?? 'Solo',
    bio: storedProfile.bio ?? 'Music Lover 🎵',
    avatarUrl: storedProfile.avatarUrl ?? '',
    settings: (auth.user?.settings as unknown as Record<string, unknown>) ?? {},
    streakDays: storedProfile.streakDays ?? 7,
    lastActiveDate: storedProfile.lastActiveDate ?? new Date().toISOString(),
  };

  // Only back up completed or valid downloads
  const completedDownloads = downloadsState.downloads.filter(
    (d) => d.phase === 'completed' || d.localUri
  );

  return {
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    profile,
    favoriteTracks: library.favoriteTracks ?? [],
    playlists: library.playlists ?? [],
    playStats: library.playStats ?? {},
    artistPlayStats: library.artistPlayStats ?? {},
    skipStats: library.skipStats ?? {},
    recentlyPlayed: library.recentlyPlayed ?? [],
    followedArtists: library.followedArtists ?? [],
    followedAlbums: library.followedAlbums ?? [],
    downloads: completedDownloads,
  };
}

/**
 * Saves current profile and library snapshot to persistent phone storage.
 */
export async function saveBackupToDevice(): Promise<{
  success: boolean;
  path?: string;
  sizeBytes?: number;
}> {
  if (!nativeBridge.backup.available()) {
    return { success: false };
  }

  useBackupStore.setState({ isSaving: true });
  try {
    const payload = buildBackupPayload();
    const jsonString = JSON.stringify(payload, null, 2);
    const result = await nativeBridge.backup.saveBackup(jsonString);

    if (result.success) {
      useBackupStore.getState().setLastBackupInfo({
        time: result.timestamp || Date.now(),
        path: result.path,
        sizeBytes: result.sizeBytes,
      });
      return {
        success: true,
        path: result.path,
        sizeBytes: result.sizeBytes,
      };
    }
    return { success: false };
  } catch (error) {
    console.warn('saveBackupToDevice failed:', error);
    return { success: false };
  } finally {
    useBackupStore.setState({ isSaving: false });
  }
}

/**
 * Reads persistent backup from phone storage.
 */
export async function readBackupFromDevice(): Promise<SincBackupPayload | null> {
  if (!nativeBridge.backup.available()) {
    return null;
  }

  try {
    const result = await nativeBridge.backup.readBackup();
    if (!result.exists || !result.data) {
      return null;
    }
    const parsed = JSON.parse(result.data) as SincBackupPayload;
    return parsed;
  } catch (error) {
    console.warn('readBackupFromDevice failed:', error);
    return null;
  }
}

/**
 * Restores state from a backup payload, verifying and reconnecting downloaded files in Music/Sinc.
 */
export async function restoreFromBackup(payload: SincBackupPayload): Promise<boolean> {
  useBackupStore.setState({ isRestoring: true });
  try {
    // 1. Scan physical files in Music/Sinc
    let scannedFiles: { fileName: string; uri: string }[] = [];
    if (nativeBridge.backup.available()) {
      try {
        scannedFiles = await nativeBridge.backup.scanDownloadedFiles();
      } catch (e) {
        console.warn('Could not scan downloaded files during restore:', e);
      }
    }
    const fileMap = new Map<string, string>();
    for (const f of scannedFiles) {
      fileMap.set(f.fileName.toLowerCase(), f.uri);
    }

    // 2. Reconnect downloads
    const reconnectedDownloads: DownloadRecord[] = [];
    const restoredDownloadIds = new Set<string>();

    for (const rec of payload.downloads ?? []) {
      const pubName = (rec.publishedName ?? '').toLowerCase();
      const directUri = pubName && fileMap.has(pubName) ? fileMap.get(pubName) : undefined;
      const finalUri = directUri ?? rec.localUri;

      const restoredRecord: DownloadRecord = {
        ...rec,
        phase: 'completed',
        progress: 100,
        localUri: finalUri,
      };
      reconnectedDownloads.push(restoredRecord);
      restoredDownloadIds.add(rec.track.id);
    }

    // Update downloads store
    useDownloadsStore.setState({
      downloads: reconnectedDownloads,
      downloadedIds: restoredDownloadIds,
    });

    // 3. Restore Library Store
    const library = useLibraryStore.getState();
    useLibraryStore.setState({
      favoriteTracks: payload.favoriteTracks ?? library.favoriteTracks,
      favoriteIds: new Set((payload.favoriteTracks ?? []).map((t) => t.id)),
      playlists: payload.playlists ?? library.playlists,
      playStats: payload.playStats ?? library.playStats,
      artistPlayStats: payload.artistPlayStats ?? library.artistPlayStats,
      skipStats: payload.skipStats ?? library.skipStats,
      recentlyPlayed: payload.recentlyPlayed ?? library.recentlyPlayed,
      followedArtists: payload.followedArtists ?? library.followedArtists,
      followedArtistIds: new Set((payload.followedArtists ?? []).map((a) => a.id)),
      followedAlbums: payload.followedAlbums ?? library.followedAlbums,
      followedAlbumIds: new Set((payload.followedAlbums ?? []).map((a) => a.id)),
    });

    // 4. Restore Profile
    if (payload.profile) {
      storage.setObject(STORAGE_KEYS.PROFILE, payload.profile);
      if (payload.profile.username) {
        useAuthStore.setState((s) => ({
          user: {
            ...s.user,
            username: payload.profile.username,
          },
        }));
      }
    }

    return true;
  } catch (error) {
    console.warn('restoreFromBackup failed:', error);
    return false;
  } finally {
    useBackupStore.setState({ isRestoring: false });
  }
}

/**
 * Checks if current app is a fresh install or empty library, and auto-restores if a backup exists.
 */
export async function autoRestoreIfFresh(): Promise<boolean> {
  const library = useLibraryStore.getState();
  const downloads = useDownloadsStore.getState();

  const isFresh =
    library.favoriteTracks.length === 0 &&
    library.playlists.length === 0 &&
    downloads.downloads.length === 0 &&
    Object.keys(library.playStats).length === 0;

  if (!isFresh) {
    return false;
  }

  const backup = await readBackupFromDevice();
  if (backup) {
    console.log('Found existing device backup, automatically restoring...');
    return await restoreFromBackup(backup);
  }
  return false;
}

let autoSaveTimer: NodeJS.Timeout | null = null;
let initializedAutoSave = false;

/**
 * Starts automatic debounced backup on store updates and app backgrounding.
 */
export function initAutoBackup(): void {
  if (initializedAutoSave) return;
  initializedAutoSave = true;

  const scheduleSave = () => {
    if (!useBackupStore.getState().autoBackupEnabled) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      void saveBackupToDevice();
    }, 6000);
  };

  // Subscribe to library updates
  useLibraryStore.subscribe(() => {
    scheduleSave();
  });

  // Subscribe to downloads updates
  useDownloadsStore.subscribe(() => {
    scheduleSave();
  });

  // Save when app transitions to background
  AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status === 'background' || status === 'inactive') {
      if (useBackupStore.getState().autoBackupEnabled) {
        void saveBackupToDevice();
      }
    }
  });

  // Attempt auto-restore on boot if fresh
  void autoRestoreIfFresh();
}
