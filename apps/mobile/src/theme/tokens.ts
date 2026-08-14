/**
 * Design tokens - the single source of truth for spacing, radii, typography,
 * color roles, z-index and motion. Pure data (no RN imports) so it is fully
 * unit-testable in any environment. Components must only consume tokens,
 * never hardcoded values.
 */

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export type SpacingToken = keyof typeof spacing;

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

export type RadiusToken = keyof typeof radius;

export const typography = {
  display: { fontSize: 34, lineHeight: 41, fontWeight: '800' as const },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600' as const },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  subhead: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  footnote: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
  caption: { fontSize: 11, lineHeight: 13, fontWeight: '500' as const },
} as const;

export type TypographyToken = keyof typeof typography;

export const fontWeights = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  heavy: '800' as const,
};

export const zIndex = {
  base: 0,
  elevated: 10,
  sticky: 20,
  miniPlayer: 40,
  modal: 50,
  overlay: 60,
  toast: 70,
} as const;

export const opacity = {
  disabled: 0.38,
  subtle: 0.6,
  overlay: 0.5,
  scrim: 0.7,
} as const;

export const durations = {
  instant: 80,
  fast: 160,
  normal: 260,
  slow: 400,
} as const;

/** Color roles per theme. Light and dark palettes map 1:1 to these roles. */
export interface ColorRoles {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  background: string;
  onBackground: string;
  surface: string;
  onSurface: string;
  surfaceContainer: string;
  onSurfaceVariant: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  outline: string;
  outlineVariant: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  success: string;
  onSuccess: string;
  warning: string;
  onWarning: string;
  info: string;
  onInfo: string;
  scrim: string;
  /** Brand accent used for artwork placeholders / gradients. */
  brand: string;
  brandVariant: string;
}

export interface ThemeTokens {
  colors: ColorRoles;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  zIndex: typeof zIndex;
  opacity: typeof opacity;
  durations: typeof durations;
  isDark: boolean;
}

export const lightColors: ColorRoles = {
  primary: '#E11D48',
  onPrimary: '#FFFFFF',
  primaryContainer: '#FFDADD',
  onPrimaryContainer: '#3E0008',
  secondary: '#74565B',
  onSecondary: '#FFFFFF',
  background: '#FCF8F9',
  onBackground: '#22191B',
  surface: '#FFFFFF',
  onSurface: '#22191B',
  surfaceContainer: '#F1E5E6',
  onSurfaceVariant: '#524347',
  surfaceContainerHigh: '#EBDFE0',
  surfaceContainerHighest: '#E5D9DA',
  outline: '#857477',
  outlineVariant: '#D7C1C4',
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',
  success: '#2E7D32',
  onSuccess: '#FFFFFF',
  warning: '#B26A00',
  onWarning: '#FFFFFF',
  info: '#00639B',
  onInfo: '#FFFFFF',
  scrim: 'rgba(0, 0, 0, 0.55)',
  brand: '#E11D48',
  brandVariant: '#FB7185',
};

export const darkColors: ColorRoles = {
  primary: '#FFB3BB',
  onPrimary: '#5E1133',
  primaryContainer: '#8C1B3B',
  onPrimaryContainer: '#FFDADD',
  secondary: '#E2BDC2',
  onSecondary: '#41292D',
  background: '#191113',
  onBackground: '#F0DEDF',
  surface: '#21181A',
  onSurface: '#F0DEDF',
  surfaceContainer: '#2D2325',
  onSurfaceVariant: '#D5C2C5',
  surfaceContainerHigh: '#382D2F',
  surfaceContainerHighest: '#43383A',
  outline: '#9E8B8F',
  outlineVariant: '#524347',
  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',
  success: '#7BC67E',
  onSuccess: '#0E3B13',
  warning: '#FFC470',
  onWarning: '#573200',
  info: '#8ACBFF',
  onInfo: '#003351',
  scrim: 'rgba(0, 0, 0, 0.65)',
  brand: '#FFB3BB',
  brandVariant: '#FB7185',
};

export function createTokens(isDark: boolean): ThemeTokens {
  return {
    colors: isDark ? darkColors : lightColors,
    spacing,
    radius,
    typography,
    zIndex,
    opacity,
    durations,
    isDark,
  };
}
