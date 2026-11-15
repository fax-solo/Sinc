import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  DiscoveryMode,
  ListeningEvent,
  ListeningInsights,
  ListeningTimeRange,
  MusicTasteProfile,
} from '@sinc/shared';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import {
  computeListeningInsights,
  computeTasteProfile,
  discoveryPreferenceForMode,
  mapDiscoveryMode,
} from './tasteProfile';
import { useLibraryStore } from '../library/libraryStore';

const MAX_STORED_EVENTS = 1000;

interface PersonalizationState {
  enabled: boolean;
  discoveryMode: DiscoveryMode;
  discoveryPreference: number;
  events: ListeningEvent[];
  initialFavoriteGenres: string[];
  initialFavoriteArtists: string[];
  onboardingCompleted: boolean;

  setEnabled: (enabled: boolean) => void;
  setDiscoveryMode: (mode: DiscoveryMode) => void;
  setDiscoveryPreference: (value: number) => void;
  recordEvent: (event: Omit<ListeningEvent, 'id' | 'timestamp'> & { timestamp?: number }) => void;
  completeOnboarding: (genres: string[], artists: string[]) => void;
  skipOnboarding: () => void;
  resetTasteProfile: () => void;
  clearEvents: () => void;
  clearAllPersonalization: () => void;

  getTasteProfile: () => MusicTasteProfile;
  getInsights: (range: ListeningTimeRange) => ListeningInsights;
}

export const usePersonalizationStore = create<PersonalizationState>()(
  persist(
    (set, get) => ({
      enabled: true,
      discoveryMode: 'balanced',
      discoveryPreference: 0.5,
      events: [],
      initialFavoriteGenres: [],
      initialFavoriteArtists: [],
      onboardingCompleted: false,

      setEnabled: (enabled) => {
        set({ enabled });
      },

      setDiscoveryMode: (mode) => {
        const pref = discoveryPreferenceForMode(mode);
        set({ discoveryMode: mode, discoveryPreference: pref });
        // Sync to library store discoveryPreference so existing components remain in lockstep
        useLibraryStore.getState().setDiscoveryPreference(pref);
      },

      setDiscoveryPreference: (value) => {
        const clamped = Math.max(0, Math.min(1, value));
        const mode = mapDiscoveryMode(clamped);
        set({ discoveryPreference: clamped, discoveryMode: mode });
        useLibraryStore.getState().setDiscoveryPreference(clamped);
      },

      recordEvent: (eventData) => {
        const state = get();
        if (!state.enabled) return;

        const now = eventData.timestamp ?? Date.now();
        const eventId = `ev-${now}-${Math.random().toString(36).slice(2, 7)}`;
        const newEvent: ListeningEvent = {
          ...eventData,
          id: eventId,
          timestamp: now,
        };

        const updated = [...state.events, newEvent];
        const trimmed =
          updated.length > MAX_STORED_EVENTS
            ? updated.slice(updated.length - MAX_STORED_EVENTS)
            : updated;

        set({ events: trimmed });
      },

      completeOnboarding: (genres, artists) => {
        set({
          initialFavoriteGenres: genres,
          initialFavoriteArtists: artists,
          onboardingCompleted: true,
        });
      },

      skipOnboarding: () => {
        set({ onboardingCompleted: true });
      },

      resetTasteProfile: () => {
        set({
          events: [],
          initialFavoriteGenres: [],
          initialFavoriteArtists: [],
        });
        useLibraryStore.getState().clearRecommendationFeedback();
      },

      clearEvents: () => {
        set({ events: [] });
      },

      clearAllPersonalization: () => {
        set({
          events: [],
          initialFavoriteGenres: [],
          initialFavoriteArtists: [],
          discoveryMode: 'balanced',
          discoveryPreference: 0.5,
          onboardingCompleted: false,
        });
        useLibraryStore.getState().clearRecommendationFeedback();
        useLibraryStore.getState().clearHistory();
      },

      getTasteProfile: () => {
        const state = get();
        const library = useLibraryStore.getState();
        const downloads = library.favoriteTracks; // fallback array
        return computeTasteProfile({
          events: state.events,
          playStats: library.playStats,
          skipStats: library.skipStats,
          artistPlayStats: library.artistPlayStats,
          favoriteTracks: library.favoriteTracks,
          followedArtists: library.followedArtists,
          followedAlbums: library.followedAlbums,
          downloadedTracks: downloads,
          thumbsUp: library.thumbsUp,
          thumbsDown: library.thumbsDown,
          hiddenTrackIds: library.hiddenTrackIds,
          hiddenArtistNames: library.hiddenArtistNames,
          initialFavoriteGenres: state.initialFavoriteGenres,
          initialFavoriteArtists: state.initialFavoriteArtists,
          discoveryMode: state.discoveryMode,
          discoveryPreference: state.discoveryPreference,
          personalizationEnabled: state.enabled,
        });
      },

      getInsights: (range: ListeningTimeRange) => {
        const state = get();
        const library = useLibraryStore.getState();
        return computeListeningInsights(state.events, library.playStats, range);
      },
    }),
    {
      name: STORAGE_KEYS.PERSONALIZATION,
      storage: createJSONStorage(() => ({
        getItem: (key) => storage.getString(key),
        setItem: (key, value) => storage.setString(key, value),
        removeItem: (key) => storage.remove(key),
      })),
      version: 1,
      partialize: (state) => ({
        enabled: state.enabled,
        discoveryMode: state.discoveryMode,
        discoveryPreference: state.discoveryPreference,
        events: state.events,
        initialFavoriteGenres: state.initialFavoriteGenres,
        initialFavoriteArtists: state.initialFavoriteArtists,
        onboardingCompleted: state.onboardingCompleted,
      }),
    }
  )
);

// Synchronize explicit library actions (likes, unlikes, follows) into rich listening events
useLibraryStore.subscribe((state, prev) => {
  if (!usePersonalizationStore.getState().enabled) return;

  // Favorite added
  if (state.favoriteTracks.length > prev.favoriteTracks.length) {
    const newlyAdded = state.favoriteTracks.find(
      (t) => !prev.favoriteTracks.some((p) => p.id === t.id)
    );
    if (newlyAdded) {
      usePersonalizationStore.getState().recordEvent({
        trackId: newlyAdded.id,
        trackTitle: newlyAdded.title,
        artistId: newlyAdded.artists[0]?.id,
        artistName: newlyAdded.artists[0]?.name ?? 'Unknown Artist',
        albumId: newlyAdded.album?.id,
        albumTitle: newlyAdded.album?.title,
        genres: newlyAdded.artists[0]?.genres,
        eventType: 'track_liked',
        playbackDurationMs: 0,
        trackDurationMs: newlyAdded.durationMs || 0,
        completionRatio: 0,
      });
    }
  } else if (state.favoriteTracks.length < prev.favoriteTracks.length) {
    const removed = prev.favoriteTracks.find(
      (t) => !state.favoriteTracks.some((p) => p.id === t.id)
    );
    if (removed) {
      usePersonalizationStore.getState().recordEvent({
        trackId: removed.id,
        trackTitle: removed.title,
        artistId: removed.artists[0]?.id,
        artistName: removed.artists[0]?.name ?? 'Unknown Artist',
        albumId: removed.album?.id,
        albumTitle: removed.album?.title,
        genres: removed.artists[0]?.genres,
        eventType: 'track_unliked',
        playbackDurationMs: 0,
        trackDurationMs: removed.durationMs || 0,
        completionRatio: 0,
      });
    }
  }

  // Followed artist added
  if (state.followedArtists.length > prev.followedArtists.length) {
    const newlyAdded = state.followedArtists.find(
      (a) => !prev.followedArtists.some((p) => p.id === a.id)
    );
    if (newlyAdded) {
      usePersonalizationStore.getState().recordEvent({
        trackId: `art-${newlyAdded.id}`,
        artistId: newlyAdded.id,
        artistName: newlyAdded.name,
        genres: newlyAdded.genres,
        eventType: 'artist_followed',
        playbackDurationMs: 0,
        trackDurationMs: 0,
        completionRatio: 0,
      });
    }
  }
});

