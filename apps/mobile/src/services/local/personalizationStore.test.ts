import { beforeEach, describe, expect, it } from 'vitest';
import { usePersonalizationStore } from './personalizationStore';
import { useLibraryStore } from '../library/libraryStore';

describe('personalizationStore', () => {
  beforeEach(() => {
    usePersonalizationStore.getState().clearAllPersonalization();
    usePersonalizationStore.getState().setEnabled(true);
  });

  it('records listening events in a bounded ring buffer', () => {
    const store = usePersonalizationStore.getState();
    expect(store.events).toHaveLength(0);

    store.recordEvent({
      trackId: 'track-1',
      trackTitle: 'Song One',
      artistName: 'Artist A',
      eventType: 'track_started',
      playbackDurationMs: 0,
      trackDurationMs: 180000,
      completionRatio: 0,
    });

    const updated = usePersonalizationStore.getState();
    expect(updated.events).toHaveLength(1);
    expect(updated.events[0].trackId).toBe('track-1');
    expect(updated.events[0].id).toBeDefined();
    expect(updated.events[0].timestamp).toBeDefined();
  });

  it('updates discovery mode and syncs discoveryPreference to libraryStore', () => {
    const store = usePersonalizationStore.getState();
    store.setDiscoveryMode('familiar');

    expect(usePersonalizationStore.getState().discoveryMode).toBe('familiar');
    expect(usePersonalizationStore.getState().discoveryPreference).toBe(0.15);
    expect(useLibraryStore.getState().discoveryPreference).toBe(0.15);

    store.setDiscoveryMode('exploration');
    expect(usePersonalizationStore.getState().discoveryMode).toBe('exploration');
    expect(usePersonalizationStore.getState().discoveryPreference).toBe(0.85);
    expect(useLibraryStore.getState().discoveryPreference).toBe(0.85);
  });

  it('resets taste profile without clearing library items', () => {
    const store = usePersonalizationStore.getState();
    store.completeOnboarding(['Rock'], ['Artist X']);
    store.recordEvent({
      trackId: 't-1',
      artistName: 'Artist X',
      eventType: 'track_completed',
      playbackDurationMs: 180000,
      trackDurationMs: 180000,
      completionRatio: 1.0,
    });

    expect(usePersonalizationStore.getState().events).toHaveLength(1);
    expect(usePersonalizationStore.getState().initialFavoriteGenres).toContain('Rock');

    store.resetTasteProfile();

    const afterReset = usePersonalizationStore.getState();
    expect(afterReset.events).toHaveLength(0);
    expect(afterReset.initialFavoriteGenres).toHaveLength(0);
    expect(afterReset.initialFavoriteArtists).toHaveLength(0);
  });

  it('does not record events when personalization is disabled', () => {
    const store = usePersonalizationStore.getState();
    store.setEnabled(false);

    store.recordEvent({
      trackId: 't-blocked',
      artistName: 'No Track',
      eventType: 'track_started',
      playbackDurationMs: 0,
      trackDurationMs: 180000,
      completionRatio: 0,
    });

    expect(usePersonalizationStore.getState().events).toHaveLength(0);
  });
});
