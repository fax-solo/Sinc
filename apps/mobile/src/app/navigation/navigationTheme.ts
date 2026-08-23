import { DefaultTheme, type Theme as NavigationTheme } from '@react-navigation/native';
import { colors } from '../../theme';

/** Maps our design tokens onto React Navigation's theme. */
export const navigationTheme: NavigationTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    primary: colors.accent,
    background: colors.background,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
    notification: colors.accent,
  },
};
