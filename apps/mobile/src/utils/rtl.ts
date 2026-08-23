/**
 * RTL helpers (M7.2). React Native flips flex layouts automatically when the
 * app runs in a right-to-left locale, but icon names don't flip with them.
 * These helpers map directional glyphs (chevrons, arrows, back/forward) so
 * they mirror correctly under RTL.
 */
import { I18nManager } from 'react-native';

export type DirectionalIcon = 'forward' | 'back';

/** The chevron glyph to use for a given direction under the current layout. */
export function chevronIcon(direction: DirectionalIcon): 'chevron-forward' | 'chevron-back' {
  const flipped = I18nManager.isRTL;
  if (direction === 'forward') return flipped ? 'chevron-back' : 'chevron-forward';
  return flipped ? 'chevron-forward' : 'chevron-back';
}

/** True when the app is currently laid out right-to-left. */
export function isRTL(): boolean {
  return I18nManager.isRTL;
}
