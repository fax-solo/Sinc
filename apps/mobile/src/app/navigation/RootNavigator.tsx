import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '../../theme';
import { useAuthStore } from '../../features/auth/authStore';
import { LoginScreen } from '../../features/auth/screens/LoginScreen';
import { RegisterScreen } from '../../features/auth/screens/RegisterScreen';
import { AlbumScreen } from '../../features/albums/AlbumScreen';
import { ArtistScreen } from '../../features/artists/ArtistScreen';
import { PlaylistScreen } from '../../features/playlists/PlaylistScreen';
import { MixScreen } from '../../features/mixes/MixScreen';
import { PlayerScreen } from '../../features/player/PlayerScreen';
import { LyricsScreen } from '../../features/lyrics/LyricsScreen';
import { navigationTheme } from './navigationTheme';
import { MainTabs } from './MainTabs';
import { linking } from './linking';
import { LockScreen } from '../../features/lock/LockScreen';
import { useLockStore } from '../../features/lock/lockStore';
import { AdminScreen } from '../../features/admin/AdminScreen';
import { UpdateRequiredScreen } from '../../features/updates/UpdateRequiredScreen';
import { useUpdateStore } from '../../features/updates/updateStore';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

function Splash() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}

/**
 * Intercepts the tree when the app lock is armed but not yet unlocked for
 * this foreground session (M7.3). Rendering the LockScreen outside the
 * navigator keeps the navigation state intact underneath.
 */
function LockGate({ children }: { children: ReactNode }) {
  const enabled = useLockStore((s) => s.enabled);
  const unlocked = useLockStore((s) => s.unlocked);
  if (enabled && !unlocked) {
    return <LockScreen />;
  }
  return <>{children}</>;
}

/**
 * Forced-update gate (M9.3): checks the server's minimum app version once per
 * session and blocks the UI until the user updates when this build is too old.
 * The API is non-blocking and failure is treated as "not blocked" so offline
 * usage is never interrupted.
 */
function UpdateGate({ children }: { children: ReactNode }) {
  const checked = useUpdateStore((s) => s.checked);
  const blocked = useUpdateStore((s) => s.blocked);
  const minAppVersion = useUpdateStore((s) => s.minAppVersion);

  useEffect(() => {
    void useUpdateStore.getState().check();
  }, []);

  if (blocked) {
    return <UpdateRequiredScreen minAppVersion={minAppVersion} />;
  }
  return <>{checked ? children : <Splash />}</>;
}

export function RootNavigator() {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);

  if (status === 'loading') {
    return <Splash />;
  }

  return (
    <UpdateGate>
      <LockGate>
        <NavigationContainer theme={navigationTheme} linking={linking}>
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              headerStyle: { backgroundColor: navigationTheme.colors.card },
              headerTintColor: navigationTheme.colors.text,
              headerTitleStyle: { color: navigationTheme.colors.text },
            }}
          >
            {user ? (
              <>
                <Stack.Screen name="Main" component={MainTabs} />
                <Stack.Screen
                  name="Player"
                  component={PlayerScreen}
                  options={{ title: 'Now Playing' }}
                />
                <Stack.Screen
                  name="Lyrics"
                  component={LyricsScreen}
                  options={{
                    title: 'Lyrics',
                    headerTransparent: true,
                    headerTitleStyle: { color: '#FFFFFF' },
                  }}
                />
                <Stack.Screen
                  name="Album"
                  component={AlbumScreen}
                  options={({ route }) => ({
                    title: route.params.title ?? 'Album',
                    headerShown: true,
                  })}
                />
                <Stack.Screen
                  name="Artist"
                  component={ArtistScreen}
                  options={({ route }) => ({
                    title: route.params.name ?? 'Artist',
                    headerShown: true,
                  })}
                />
                <Stack.Screen
                  name="Playlist"
                  component={PlaylistScreen}
                  options={({ route }) => ({
                    title: route.params.name ?? 'Playlist',
                    headerShown: true,
                  })}
                />
                <Stack.Screen
                  name="Mix"
                  component={MixScreen}
                  options={({ route }) => ({
                    title: route.params.mix?.name ?? 'Mix',
                    headerShown: true,
                  })}
                />
                {user.role === 'admin' ? (
                  <Stack.Screen
                    name="Admin"
                    component={AdminScreen}
                    options={{ title: 'Admin', headerShown: false }}
                  />
                ) : null}
              </>
            ) : (
              <>
                <Stack.Screen name="Login" component={LoginScreen} />
                <Stack.Screen name="Register" component={RegisterScreen} />
              </>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </LockGate>
    </UpdateGate>
  );
}
