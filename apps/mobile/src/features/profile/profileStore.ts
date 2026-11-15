import { create } from 'zustand';
import { storage, STORAGE_KEYS } from '../../utils/storage';

export interface AvatarPreset {
  id: string;
  name: string;
  url: string;
  backgroundColor: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: 'avatar-1',
    name: 'Twilight Anime',
    url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80',
    backgroundColor: '#3b2d54',
  },
  {
    id: 'avatar-2',
    name: 'Sunset Boy',
    url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop&q=80',
    backgroundColor: '#543b2d',
  },
  {
    id: 'avatar-3',
    name: 'City Skyline',
    url: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&auto=format&fit=crop&q=80',
    backgroundColor: '#2d3b54',
  },
  {
    id: 'avatar-4',
    name: 'Cyberpunk Neon',
    url: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80',
    backgroundColor: '#4a2d54',
  },
];

export const ACCENT_COLORS = [
  { id: 'green', color: '#1ED760', label: 'Emerald' },
  { id: 'blue', color: '#3B82F6', label: 'Sky' },
  { id: 'indigo', color: '#6366F1', label: 'Indigo' },
  { id: 'pink', color: '#EC4899', label: 'Rose' },
  { id: 'orange', color: '#F97316', label: 'Amber' },
  { id: 'yellow', color: '#EAB308', label: 'Gold' },
] as const;

export type ThemeMode = 'dark' | 'light' | 'system';
export type TextSize = 'small' | 'normal' | 'large';
export type DownloadQuality = 'standard' | 'high' | 'lossless';

export interface UserProfileData {
  username: string;
  bio: string;
  avatarId: string;
  customAvatarUri?: string;
  badge: string;
  streakDays: number;
  lastActiveDate: string;
  theme: ThemeMode;
  accentColor: string;
  dynamicColor: boolean;
  reduceMotion: boolean;
  textSize: TextSize;
  downloadQuality: DownloadQuality;
  downloadOnWifiOnly: boolean;
  autoDownload: boolean;
  downloadFolder: string;
}

export interface ProfileStore extends UserProfileData {
  setUsername: (username: string) => void;
  setBio: (bio: string) => void;
  setAvatarId: (avatarId: string) => void;
  setCustomAvatarUri: (uri?: string) => void;
  setTheme: (theme: ThemeMode) => void;
  setAccentColor: (accentColor: string) => void;
  setDynamicColor: (dynamicColor: boolean) => void;
  setReduceMotion: (reduceMotion: boolean) => void;
  setTextSize: (textSize: TextSize) => void;
  setDownloadQuality: (quality: DownloadQuality) => void;
  setDownloadOnWifiOnly: (wifiOnly: boolean) => void;
  setAutoDownload: (autoDownload: boolean) => void;
  setDownloadFolder: (folder: string) => void;
  updateProfile: (patch: Partial<UserProfileData>) => void;
  resetProfile: () => void;
}

const DEFAULT_PROFILE: UserProfileData = {
  username: 'Solo',
  bio: 'Music Lover 🎵',
  avatarId: 'avatar-1',
  customAvatarUri: undefined,
  badge: 'Premium User',
  streakDays: 7,
  lastActiveDate: new Date().toISOString(),
  theme: 'dark',
  accentColor: '#1ED760',
  dynamicColor: true,
  reduceMotion: false,
  textSize: 'normal',
  downloadQuality: 'high',
  downloadOnWifiOnly: true,
  autoDownload: false,
  downloadFolder: 'Music/Sinc',
};

const persisted = storage.getObject<UserProfileData>(STORAGE_KEYS.PROFILE) ?? {};
const initialState: UserProfileData = {
  ...DEFAULT_PROFILE,
  ...persisted,
};

export const useProfileStore = create<ProfileStore>((set, get) => ({
  ...initialState,

  setUsername: (username) => get().updateProfile({ username: username.trim() || 'Solo' }),
  setBio: (bio) => get().updateProfile({ bio: bio.slice(0, 100) }),
  setAvatarId: (avatarId) => get().updateProfile({ avatarId }),
  setCustomAvatarUri: (customAvatarUri) => get().updateProfile({ customAvatarUri }),
  setTheme: (theme) => get().updateProfile({ theme }),
  setAccentColor: (accentColor) => get().updateProfile({ accentColor }),
  setDynamicColor: (dynamicColor) => get().updateProfile({ dynamicColor }),
  setReduceMotion: (reduceMotion) => get().updateProfile({ reduceMotion }),
  setTextSize: (textSize) => get().updateProfile({ textSize }),
  setDownloadQuality: (downloadQuality) => get().updateProfile({ downloadQuality }),
  setDownloadOnWifiOnly: (downloadOnWifiOnly) => get().updateProfile({ downloadOnWifiOnly }),
  setAutoDownload: (autoDownload) => get().updateProfile({ autoDownload }),
  setDownloadFolder: (downloadFolder) => get().updateProfile({ downloadFolder }),

  updateProfile: (patch) => {
    set((state) => {
      const updated = { ...state, ...patch };
      storage.setObject(STORAGE_KEYS.PROFILE, {
        username: updated.username,
        bio: updated.bio,
        avatarId: updated.avatarId,
        customAvatarUri: updated.customAvatarUri,
        badge: updated.badge,
        streakDays: updated.streakDays,
        lastActiveDate: updated.lastActiveDate,
        theme: updated.theme,
        accentColor: updated.accentColor,
        dynamicColor: updated.dynamicColor,
        reduceMotion: updated.reduceMotion,
        textSize: updated.textSize,
        downloadQuality: updated.downloadQuality,
        downloadOnWifiOnly: updated.downloadOnWifiOnly,
        autoDownload: updated.autoDownload,
        downloadFolder: updated.downloadFolder,
      });
      return patch;
    });
  },

  resetProfile: () => {
    storage.remove(STORAGE_KEYS.PROFILE);
    set(DEFAULT_PROFILE);
  },
}));
