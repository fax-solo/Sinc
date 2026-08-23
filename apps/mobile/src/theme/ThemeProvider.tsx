import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { colors, elevation, radii, spacing, typography } from './tokens';

export interface Theme {
  colors: typeof colors;
  spacing: typeof spacing;
  typography: typeof typography;
  radii: typeof radii;
  elevation: typeof elevation;
  isDark: boolean;
}

export const darkTheme: Theme = {
  colors,
  spacing,
  typography,
  radii,
  elevation,
  isDark: true,
};

const ThemeContext = createContext<Theme>(darkTheme);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => darkTheme, []);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
