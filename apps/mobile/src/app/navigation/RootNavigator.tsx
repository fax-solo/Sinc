import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { LockScreen } from '../../features/lock/LockScreen';
import { useLockStore } from '../../features/lock/lockStore';
import { V2Tabs } from '../../v2/navigation/V2Tabs';
import { V2PlayerScreen } from '../../v2/screens/V2PlayerScreen';
import { V2LyricsScreen } from '../../v2/screens/V2LyricsScreen';
import {
  V2AlbumScreen,
  V2ArtistScreen,
  V2PlaylistScreen,
  V2MixScreen,
} from '../../v2/screens/V2CollectionScreens';
import { linking } from './linking';
import { navigationTheme } from './navigationTheme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Overlays the tree when the app lock is armed but not yet unlocked for
 * this foreground session (M7.3). Children STAY MOUNTED underneath — the
 * navigator's state survives unlock, so backgrounding on the Player screen
 * doesn't dump the user back to the Home tab. (Swapping in the LockScreen
 * *instead of* children used to unmount the NavigationContainer entirely,
 * resetting stack depth, tabs, and scroll positions on every unlock.)
 */
function LockGate({ children }: { children: ReactNode }) {
  const enabled = useLockStore((s) => s.enabled);
  const unlocked = useLockStore((s) => s.unlocked);
  const needsLock = enabled && !unlocked;
  return (
    <>
      {children}
      {needsLock && (
        <View pointerEvents="auto" style={styles.overlay}>
          <LockScreen />
        </View>
      )}
    </>
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
      <NavigationContainer theme={navigationTheme} linking={linking}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main" component={V2Tabs} />
          <Stack.Screen name="Player" component={V2PlayerScreen} />
          <Stack.Screen name="Lyrics" component={V2LyricsScreen} />
          <Stack.Screen name="Album" component={V2AlbumScreen} />
          <Stack.Screen name="Artist" component={V2ArtistScreen} />
          <Stack.Screen name="Playlist" component={V2PlaylistScreen} />
          <Stack.Screen name="Mix" component={V2MixScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </LockGate>
  );
}
