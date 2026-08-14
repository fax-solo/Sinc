import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  type PropsWithChildren,
} from 'react';
import { useColorScheme } from 'react-native';
import { createTokens, type ThemeTokens } from './tokens';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  mode: ThemeMode;
  /** Resolved tokens honoring system color scheme when mode === 'system'. */
  tokens: ThemeTokens;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialMode = 'system',
}: PropsWithChildren<{ initialMode?: ThemeMode }>): React.JSX.Element {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>(initialMode);

  const isDark = mode === 'system' ? systemScheme === 'dark' : mode === 'dark';
  const tokens = useMemo(() => createTokens(isDark), [isDark]);

  const toggle = useCallback(() => {
    setMode((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, tokens, isDark, setMode, toggle }),
    [mode, tokens, isDark, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
