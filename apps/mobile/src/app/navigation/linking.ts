/**
 * Deep-link configuration (M7.1). Maps public URLs (`sinc://…` and
 * `https://sinc.app/…`) onto the navigation tree. Routable entities:
 * song, album, artist, playlist and mix. Song links resolve to the Player
 * with a `trackId` that the screen loads and plays; mix links carry only the
 * mix id and are resolved against the personalized home feed.
 */
import type { LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from './types';

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['sinc://', 'https://sinc.app', 'sincapp://'],
  config: {
    screens: {
      Main: {
        screens: {
          Home: 'home',
          Search: 'search',
          Library: 'library',
        },
      },
      Player: 'song/:trackId',
      Album: 'album/:id',
      Artist: 'artist/:id',
      Playlist: 'playlist/:id',
      Mix: 'mix/:mixId',
    },
  },
};
