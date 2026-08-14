import React, { useEffect } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../state/authStore';
import { usePlaybackStore } from '../state/playbackStore';
import { useSyncEngine } from '../hooks/useSyncEngine';
import { useDownloadsEngine } from '../downloads/useDownloadsEngine';
import AuthStack from './AuthStack';
import MainTabs from './MainTabs';
import PlayerScreen from '../screens/PlayerScreen';
import PlayerLyricsScreen from '../screens/PlayerLyricsScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Root navigator. Hydrates the persisted session on mount (SecureStorage +
 * KVStorage), then switches between the Auth stack and the main tab
 * navigator based on the restored session. Also pauses playback when the
 * app leaves the foreground (interruption handling).
 */
export default function RootNavigator(): React.JSX.Element {
  const user = useAuthStore((s) => s.user);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const hydrate = useAuthStore((s) => s.hydrate);
  const pausePlayback = usePlaybackStore((s) => s.pause);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') pausePlayback();
    });
    return () => subscription.remove();
  }, [pausePlayback]);

  useSyncEngine();
  useDownloadsEngine();

  if (!isHydrated) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="FullPlayer" component={PlayerScreen} />
          <Stack.Screen
            name="LyricsScreen"
            component={PlayerLyricsScreen}
            options={{ headerShown: true, title: '' }}
          />
        </>
      ) : (
        <Stack.Screen name="Auth" component={AuthStack} />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
