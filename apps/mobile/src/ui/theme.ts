/**
 * Sinc UI design tokens. This is the visual source of truth for the current
 * interface: a dark, quiet charcoal base with one vivid green accent.
 */
import { Platform, type TextStyle } from 'react-native';

export const colors = {
  background: '#0B0F0E',
  backgroundRaised: '#121817',
  surface: '#161D1B',
  card: '#1B2321',
  cardPressed: '#232D2A',
  input: '#222B29',
  accent: '#1ED760',
  accentBright: '#43E58B',
  accentSoft: 'rgba(30, 215, 96, 0.14)',
  onAccent: '#04140A',
  text: '#FFFFFF',
  textSecondary: '#B3BDB8',
  textMuted: '#7F8A84',
  border: '#2B3531',
  borderSoft: 'rgba(255, 255, 255, 0.08)',
  error: '#FF5B65',
  warning: '#F5C451',
  success: '#43E58B',
  overlay: 'rgba(0, 0, 0, 0.62)',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
} as const;

export const radii = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
  full: 999,
} as const;

const fontFamily = Platform.select({ ios: 'System', android: 'sans-serif' });

type Variant =
  | 'display'
  | 'title'
  | 'headline'
  | 'bodyLarge'
  | 'body'
  | 'bodyStrong'
  | 'small'
  | 'caption'
  | 'micro';

export const typography: Record<Variant, TextStyle> = {
  display: {
    fontFamily,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: colors.text,
  },
  title: {
    fontFamily,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: colors.text,
  },
  headline: {
    fontFamily,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: colors.text,
  },
  bodyLarge: {
    fontFamily,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    color: colors.text,
  },
  body: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    color: colors.text,
  },
  bodyStrong: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: colors.text,
  },
  small: {
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  caption: {
    fontFamily,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
    color: colors.textMuted,
  },
  micro: {
    fontFamily,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0.7,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
};

/** Standard horizontal gutter for full screens. */
export const pageGutter = 20;

/** Height of the tab bar, excluding the device safe-area inset. */
export const tabBarHeight = 58;
/** Height of the mini player, excluding the tab bar. */
export const miniPlayerHeight = 58;
