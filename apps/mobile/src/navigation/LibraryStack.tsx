import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import LibraryScreen from '../screens/library/LibraryScreen';
import TracksScreen from '../screens/library/TracksScreen';
import ArtistsScreen from '../screens/library/ArtistsScreen';
import AlbumsScreen from '../screens/library/AlbumsScreen';
import PlaylistsScreen from '../screens/library/PlaylistsScreen';
import FavoritesScreen from '../screens/library/FavoritesScreen';
import RecentlyPlayedScreen from '../screens/library/RecentlyPlayedScreen';
import HistoryScreen from '../screens/library/HistoryScreen';
import SongDetailsScreen from '../screens/SongDetailsScreen';
import ArtistDetailsScreen from '../screens/ArtistDetailsScreen';
import AlbumDetailsScreen from '../screens/AlbumDetailsScreen';
import PlaylistDetailsScreen from '../screens/PlaylistDetailsScreen';
import PlaceholderScreen from '../components/PlaceholderScreen';
import type { LibraryTabParamList } from './types';

const Stack = createNativeStackNavigator<LibraryTabParamList>();

export default function LibraryStack(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="LibraryRoot" component={LibraryScreen} />
      <Stack.Screen
        name="Tracks"
        component={TracksScreen}
        options={{ title: t('library.tracks') }}
      />
      <Stack.Screen
        name="Artists"
        component={ArtistsScreen}
        options={{ title: t('library.artists') }}
      />
      <Stack.Screen
        name="Albums"
        component={AlbumsScreen}
        options={{ title: t('library.albums') }}
      />
      <Stack.Screen
        name="Playlists"
        component={PlaylistsScreen}
        options={{ title: t('library.playlists') }}
      />
      <Stack.Screen
        name="Favorites"
        component={FavoritesScreen}
        options={{ title: t('library.favorites') }}
      />
      <Stack.Screen
        name="RecentlyPlayed"
        component={RecentlyPlayedScreen}
        options={{ title: t('library.recent') }}
      />
      <Stack.Screen
        name="RecentlyDownloaded"
        component={() => (
          <PlaceholderScreen
            title={t('library.downloads')}
            subtitle={t('library.downloadsComingSoon')}
          />
        )}
        options={{ title: t('library.downloads') }}
      />
      <Stack.Screen
        name="History"
        component={HistoryScreen}
        options={{ title: t('library.history') }}
      />
      <Stack.Screen
        name="SongDetails"
        component={SongDetailsScreen}
        options={{ title: t('detail.song') }}
      />
      <Stack.Screen
        name="ArtistDetails"
        component={ArtistDetailsScreen}
        options={{ title: t('detail.artist') }}
      />
      <Stack.Screen
        name="AlbumDetails"
        component={AlbumDetailsScreen}
        options={{ title: t('detail.album') }}
      />
      <Stack.Screen
        name="PlaylistDetails"
        component={PlaylistDetailsScreen}
        options={{ title: t('detail.playlist') }}
      />
    </Stack.Navigator>
  );
}
