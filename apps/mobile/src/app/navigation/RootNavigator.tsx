import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { LockScreen } from '../../features/lock/LockScreen';
import { useLockStore } from '../../features/lock/lockStore';
import { MainTabs } from './MainTabs';
import { PlayerScreen } from '../../ui/screens/PlayerScreen';
import { LyricsScreen } from '../../ui/screens/LyricsScreen';
import { QueueScreen } from '../../ui/screens/QueueScreen';
import { AlbumScreen, ArtistScreen, LocalPlaylistScreen, MixScreen, PlaylistScreen } from '../../ui/screens/CollectionScreens';
import { ProfileScreen } from '../../ui/screens/ProfileScreen';
import { EditProfileScreen } from '../../ui/screens/EditProfileScreen';
import { AppearanceScreen } from '../../ui/screens/AppearanceScreen';
import { StorageDownloadsScreen } from '../../ui/screens/StorageDownloadsScreen';
import { NotificationsScreen } from '../../ui/screens/NotificationsScreen';
import { DownloadsScreen } from '../../ui/screens/DownloadsScreen';
import { SettingsScreen } from '../../ui/screens/SettingsScreen';
import { SecurityScreen } from '../../ui/screens/SecurityScreen';
import { AboutScreen } from '../../ui/screens/AboutScreen';
import { SpotifyImportScreen } from '../../ui/screens/SpotifyImportScreen';
import { RecentlyPlayedScreen } from '../../ui/screens/RecentlyPlayedScreen';
import { BrowseCategoryScreen } from '../../ui/screens/BrowseCategoryScreen';
import { PlaylistEditorScreen } from '../../ui/screens/PlaylistEditorScreen';
import { AddSongsScreen } from '../../ui/screens/AddSongsScreen';
import { SongMenuHost } from '../../ui/songMenu/SongMenuHost';
import { ToastHost } from '../../ui/components/Overlays';
import { navigationRef } from '../../ui/navigation/navigation';
import { linking } from './linking';
import { navigationTheme } from './navigationTheme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Overlays the tree when the app lock is armed but not yet unlocked for
 * this foreground session. The navigator stays mounted underneath so unlock
 * does not reset tabs, stack depth or scroll positions.
 */
function LockGate({ children }: { children: ReactNode }) {
  const enabled = useLockStore((s) => s.enabled);
  const unlocked = useLockStore((s) => s.unlocked);
  const needsLock = enabled && !unlocked;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>{children}</View>
      <ToastHost />
      {needsLock ? (
        <View pointerEvents="auto" style={styles.overlay}>
          <LockScreen />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    elevation: 100,
  },
});

export function RootNavigator() {
  return (
    <LockGate>
      <NavigationContainer ref={navigationRef} theme={navigationTheme} linking={linking}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: navigationTheme.colors.background },
          }}
        >
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen
            name="Player"
            component={PlayerScreen}
            options={{ animation: 'slide_from_bottom' }}
          />
          <Stack.Screen name="Lyrics" component={LyricsScreen} />
          <Stack.Screen name="Queue" component={QueueScreen} />
          <Stack.Screen name="Album" component={AlbumScreen} />
          <Stack.Screen name="Artist" component={ArtistScreen} />
          <Stack.Screen name="Playlist" component={PlaylistScreen} />
          <Stack.Screen name="LocalPlaylist" component={LocalPlaylistScreen} />
          <Stack.Screen name="Mix" component={MixScreen} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
          <Stack.Screen name="EditProfile" component={EditProfileScreen} />
          <Stack.Screen name="Appearance" component={AppearanceScreen} />
          <Stack.Screen name="StorageDownloads" component={StorageDownloadsScreen} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
          <Stack.Screen name="Downloads" component={DownloadsScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="Security" component={SecurityScreen} />
          <Stack.Screen name="About" component={AboutScreen} />
          <Stack.Screen name="SpotifyImport" component={SpotifyImportScreen} />
          <Stack.Screen name="RecentlyPlayed" component={RecentlyPlayedScreen} />
          <Stack.Screen name="BrowseCategory" component={BrowseCategoryScreen} />
          <Stack.Screen name="PlaylistEditor" component={PlaylistEditorScreen} />
          <Stack.Screen name="AddSongs" component={AddSongsScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      <SongMenuHost />
    </LockGate>
  );
}
