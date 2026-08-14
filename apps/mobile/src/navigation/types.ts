import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  VerifyEmail: { token?: string } | undefined;
};

export type HomeTabParamList = {
  HomeScreen: undefined;
  SongDetails: { trackId: string };
  ArtistDetails: { artistId: string };
  AlbumDetails: { albumId: string };
  PlaylistDetails: { playlistId: string };
};

export type SearchTabParamList = {
  SearchScreen: undefined;
  SearchResults: { query?: string } | undefined;
  SongDetails: { trackId: string };
  ArtistDetails: { artistId: string };
  AlbumDetails: { albumId: string };
  PlaylistDetails: { playlistId: string };
};

export type LibraryTabParamList = {
  LibraryRoot: undefined;
  Tracks: undefined;
  Artists: undefined;
  Albums: undefined;
  Playlists: undefined;
  Favorites: undefined;
  RecentlyPlayed: undefined;
  RecentlyDownloaded: undefined;
  History: undefined;
  SongDetails: { trackId: string };
  ArtistDetails: { artistId: string };
  AlbumDetails: { albumId: string };
  PlaylistDetails: { playlistId: string };
};

export type DownloadsTabParamList = {
  DownloadsDashboard: undefined;
  DownloadQueue: undefined;
  DownloadDetails: { downloadId: string };
  DownloadSettings: undefined;
};

export type ProfileTabParamList = {
  ProfileScreen: undefined;
  Account: undefined;
  Notifications: undefined;
  Storage: undefined;
  PlaybackSettings: undefined;
  DownloadSettings: undefined;
  LyricsSettings: undefined;
  Privacy: undefined;
  Security: undefined;
  About: undefined;
};

export type MainTabsParamList = {
  Home: NavigatorScreenParams<HomeTabParamList>;
  Search: NavigatorScreenParams<SearchTabParamList>;
  Library: NavigatorScreenParams<LibraryTabParamList>;
  Downloads: NavigatorScreenParams<DownloadsTabParamList>;
  Profile: NavigatorScreenParams<ProfileTabParamList>;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList> | undefined;
  Main: NavigatorScreenParams<MainTabsParamList> | undefined;
  FullPlayer: undefined;
  LyricsScreen: { trackId: string } | undefined;
};

export type RootRouteName = keyof RootStackParamList;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
