import { DefaultTheme, type Theme as NavigationTheme } from '@react-navigation/native';
import { colors } from '../../ui/theme';

/** Maps the Sinc UI tokens onto React Navigation's theme. */
export const navigationTheme: NavigationTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    primary: colors.accent,
    background: colors.background,
    card: colors.backgroundRaised,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
};
