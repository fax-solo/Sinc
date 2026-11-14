import { createNavigationContainerRef } from '@react-navigation/native';
import type {
  MainTabName,
  MainTabParamList,
  RootStackParamList,
} from '../../app/navigation/types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Switches to a bottom tab without growing the root stack. The tab navigator
 * lives under `Main`, so this targets its route and lets React Navigation apply
 * the tab change. Optional tab params (search query, library category) are
 * forwarded when present.
 */
export function openTab<Name extends MainTabName>(
  tab: Name,
  params?: MainTabParamList[Name]
): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Main', {
    screen: tab,
    params,
  } as never);
}

export function openPlayer(): void {
  if (navigationRef.isReady()) navigationRef.navigate('Player');
}

export function goBackOrHome(): void {
  if (!navigationRef.isReady()) return;
  if (navigationRef.canGoBack()) navigationRef.goBack();
  else navigationRef.navigate('Main', { screen: 'Home' });
}

export function navigateTo<Name extends keyof RootStackParamList>(
  name: Name,
  params?: RootStackParamList[Name]
): void {
  if (!navigationRef.isReady()) return;
  // React Navigation's generic overload needs the union here; runtime is fine.
  (navigationRef.navigate as (name: string, params?: unknown) => void)(name, params);
}

export function isPlayerScreen(name: string): boolean {
  return name === 'Player' || name === 'Lyrics' || name === 'Queue';
}
