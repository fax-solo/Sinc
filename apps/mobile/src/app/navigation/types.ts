import type { DailyMix } from '../../api/music';

export type MainTabParamList = {
  Home: undefined;
  Search: undefined;
  Library: undefined;
};

export type RootStackParamList = {
  Main: undefined;
  Login: undefined;
  Register: undefined;
  Player: { trackId?: string } | undefined;
  Lyrics: undefined;
  Album: { id: string; title?: string };
  Artist: { id: string; name?: string };
  Playlist: { id: string; name?: string };
  Mix: { mix?: DailyMix; mixId?: string };
  Admin: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};
