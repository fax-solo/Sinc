import type { NavigatorScreenParams } from '@react-navigation/native';
import type { DailyMix } from '../../api/music';

export type LibraryCategory = 'Playlists' | 'Albums' | 'Artists' | 'Downloads' | 'Liked';

export type MainTabParamList = {
  Home: undefined;
  Search: { query?: string } | undefined;
  Library: { category?: LibraryCategory } | undefined;
};

export type MainTabName = keyof MainTabParamList;

export type BrowseCategoryKind = 'made-for-you' | 'charts' | 'new-releases' | 'moods';

export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  Player: { trackId?: string } | undefined;
  Lyrics: undefined;
  Queue: undefined;
  Album: { id: string; title?: string };
  Artist: { id: string; name?: string };
  /** Provider playlist. */
  Playlist: { id: string; name?: string };
  /** Persisted on-device playlist. */
  LocalPlaylist: { id: string };
  Mix: { mix?: DailyMix; mixId?: string };
  Profile: undefined;
  EditProfile: undefined;
  Appearance: undefined;
  StorageDownloads: undefined;
  Notifications: undefined;
  Downloads: undefined;
  Settings: undefined;
  Security: undefined;
  About: undefined;
  SpotifyImport: { initialUrl?: string } | undefined;
  RecentlyPlayed: undefined;
  BrowseCategory: { kind: BrowseCategoryKind; title: string };
  PlaylistEditor: { playlistId?: string; mode?: 'create' | 'edit' } | undefined;
  AddSongs: { playlistId: string };
};
