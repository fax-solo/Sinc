/**
 * Design tokens — the single source of truth for the visual language.
 * Dark-first; a light theme can be added later as another token set.
 */

export const colors = {
  background: '#121212',
  surface: '#181818',
  surfaceElevated: '#282828',
  border: 'rgba(255, 255, 255, 0.1)',
  textPrimary: '#FFFFFF',
  textSecondary: '#B3B3B3',
  textMuted: '#7A7A7A',
  accent: '#1DB954',
  accentMuted: 'rgba(29, 185, 84, 0.15)',
  onAccent: '#000000',
  error: '#F2485B',
  success: '#1ED760',
  warning: '#F5A623',
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
  huge: 48,
  enormous: 64,
} as const;

export const typography = {
  sizes: {
    caption: 12,
    small: 13,
    body: 14,
    bodyLarge: 16,
    title: 18,
    headline: 20,
    displaySmall: 24,
    display: 28,
    displayLarge: 34,
  },
  weights: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    heavy: '800',
  } as const,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

export const elevation = {
  none: 0,
  low: 2,
  medium: 4,
  high: 8,
} as const;
