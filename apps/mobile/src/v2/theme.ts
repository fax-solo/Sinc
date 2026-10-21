/**
 * V2 design tokens. The color palette is intentionally identical to the legacy
 * theme (`theme/tokens.ts` — imported, not duplicated, so the palette cannot
 * drift). What changes is geometry and type: bigger radii, roomier rows,
 * bolder display type and pill actions.
 */
import { colors } from '../theme/tokens';

export const v2Colors = colors;

export const v2Radii = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  full: 999,
} as const;

export const v2Spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export type V2TextVariant = 'display' | 'title' | 'headline' | 'body' | 'small' | 'caption';

export type V2ColorName =
  | 'textPrimary'
  | 'textSecondary'
  | 'textMuted'
  | 'accent'
  | 'onAccent'
  | 'error'
  | 'success'
  | 'warning';
