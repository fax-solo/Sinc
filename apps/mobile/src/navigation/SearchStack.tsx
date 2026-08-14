import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import SearchScreen from '../screens/SearchScreen';
import SongDetailsScreen from '../screens/SongDetailsScreen';
import ArtistDetailsScreen from '../screens/ArtistDetailsScreen';
import AlbumDetailsScreen from '../screens/AlbumDetailsScreen';
import PlaylistDetailsScreen from '../screens/PlaylistDetailsScreen';
import type { SearchTabParamList } from './types';

const Stack = createNativeStackNavigator<SearchTabParamList>();

export default function SearchStack(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SearchScreen" component={SearchScreen} />
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
