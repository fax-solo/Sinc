/**
 * Home-screen widget extension point (M7.4).
 *
 * This is the ARCHITECTURE HOOK for Android AppWidgets ("now playing" and
 * "quick play" widgets): a typed bridge surface that JS can talk to, with a
 * safe no-op fallback so the app runs without the native widget support.
 *
 * To implement the widgets:
 *  1. Add a Kotlin `AppWidgetProvider` (e.g. `SincWidgetProvider`) that
 *     renders the "now playing" layout from the active media session, plus a
 *     "quick play" widget with tappable mix shortcuts.
 *  2. Expose it to JS through a React module (SincWidgets) mirroring
 *     `WidgetBridge` below, following the same pattern as `SincPlayer`.
 *  3. Update `createWidgetBridge()` below to return the live module instead
 *     of the unavailable stub, and have widgets push `onUpdate` events so the
 *     JS side can repaint artwork/title when playback changes.
 */
import type { CanonicalTrack } from '@sinc/shared';

/** The data a widget needs to paint the "now playing" card. */
export interface WidgetNowPlaying {
  title: string;
  artist: string;
  artworkUrl?: string;
  isPlaying: boolean;
}

export interface HomeWidgetBridge {
  /** True when the native widget module is linked. */
  available(): boolean;
  /** Pushes fresh now-playing data into the widgets (fire-and-forget). */
  updateNowPlaying(track: CanonicalTrack | null, isPlaying: boolean): Promise<void>;
  /** Registers quick-play shortcuts (mix ids) for the "quick play" widget. */
  setQuickPlayShortcuts(mixIds: string[]): Promise<void>;
}

function unavailable(method: string): () => Promise<never> {
  return async () => {
    throw new Error(`Native widget method "${method}" is unavailable.`);
  };
}

function createUnavailableWidgets(): HomeWidgetBridge {
  return {
    available: () => false,
    updateNowPlaying: unavailable('widgets.updateNowPlaying'),
    setQuickPlayShortcuts: unavailable('widgets.setQuickPlayShortcuts'),
  };
}

export const widgetBridge: HomeWidgetBridge = createUnavailableWidgets();
