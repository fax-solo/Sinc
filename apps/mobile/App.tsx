import React, { useEffect, useState } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { initI18n } from './src/i18n';
import { createQueryClient } from './src/api/queryClient';
import { useAuthStore } from './src/state/authStore';
import RootNavigator from './src/navigation/RootNavigator';
import MiniPlayer from './src/components/MiniPlayer';
import AudioHost from './src/audio/AudioHost';

const queryClient = createQueryClient();

function ThemedApp(): React.JSX.Element {
  const { tokens, isDark } = useTheme();
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={tokens.colors.background}
      />
      <NavigationContainer>
        <RootNavigator />
        <MiniPlayer />
      </NavigationContainer>
      <AudioHost />
    </>
  );
}

function App(): React.JSX.Element | null {
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    void initI18n().then(() => {
      if (mounted) setI18nReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!i18nReady) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ThemedApp />
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

export default App;
