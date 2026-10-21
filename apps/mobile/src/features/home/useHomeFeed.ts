import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  dedupeSections,
  musicApi,
  type HomeFeed,
  type HomeSection,
  type PersonalizedHomeFeed,
} from '../../api/music';
import {
  getCachedHome,
  setCachedHome,
  getCachedPersonalizedHome,
  setCachedPersonalizedHome,
} from '../../api/resultCache';
import { useAuthStore } from '../auth/authStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useLocalDigest } from './localDigest';
import { buildLibraryPayload } from './libraryPayload';

export interface HomeFeedBundle {
  home: HomeFeed;
  personalized: PersonalizedHomeFeed | null;
}

/** Maps the public global feed into Home sections (signed-out / fallback). */
function globalSections(feed: HomeFeed): HomeSection[] {
  const sections: HomeSection[] = [];
  if (feed.starterMixes.length > 0) {
    sections.push({ kind: 'mixes', title: 'Made for you', mixes: feed.starterMixes });
  }
  if (feed.popularTracks.length > 0) {
    sections.push({
      kind: 'tracks',
      title: 'Trending songs',
      tracks: feed.popularTracks.slice(0, 12),
    });
  }
  if (feed.newAlbums.length > 0) {
    sections.push({ kind: 'albums', title: 'New releases', albums: feed.newAlbums });
  }
  if (feed.topPlaylists.length > 0) {
    sections.push({ kind: 'playlists', title: 'Popular playlists', playlists: feed.topPlaylists });
  }
  if (feed.topArtists.length > 0) {
    sections.push({ kind: 'artists', title: 'Trending artists', artists: feed.topArtists });
  }
  return sections;
}

export function useHomeFeed() {
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id);
  const signedIn = status === 'signedIn';
  // Cache blobs hold hundreds of canonical tracks; JSON-parsing them on
  // every render (Home re-renders on every download progress tick) was hot
  // jank. They only matter as cold-start seeds, so read them once per mount.
  const cachedHome = useMemo(() => getCachedHome(), []);
  const cachedPersonalized = useMemo(
    () => (userId ? getCachedPersonalizedHome(userId) : null),
    [userId]
  );

  const playlists = useLibraryStore((s) => s.playlists);
  const recentlyPlayedPlaylistIds = useLibraryStore((s) => s.recentlyPlayedPlaylistIds);
  const followedArtists = useLibraryStore((s) => s.followedArtists);
  const followedAlbums = useLibraryStore((s) => s.followedAlbums);
  const favoriteTracks = useLibraryStore((s) => s.favoriteTracks);
  const downloads = useDownloadsStore((s) => s.downloads);
  const thumbsUp = useLibraryStore((s) => s.thumbsUp);
  const thumbsDown = useLibraryStore((s) => s.thumbsDown);
  const hiddenTrackIds = useLibraryStore((s) => s.hiddenTrackIds);
  const hiddenArtistNames = useLibraryStore((s) => s.hiddenArtistNames);
  // NOTE: play/skip stats AND discoveryPreference are deliberately excluded.
  // They change constantly (every song start / every slider tap), and a new
  // queryKey fetches immediately — including them refired the whole
  // personalized feed mid-listening and reordered sections under the user.
  // fresh signals (including the taste slider) still flow into the NEXT
  // natural fetch via buildLibraryPayload() — on stale expiry or manual
  // refresh — which also matches how Spotify applies taste changes gradually.
  const libraryVersion = useMemo(
    () =>
      `${playlists.length}:${recentlyPlayedPlaylistIds.length}:${followedArtists.length}:${followedAlbums.length}:${favoriteTracks.length}:${downloads.length}:${Object.keys(thumbsUp).length + Object.keys(thumbsDown).length}:${hiddenTrackIds.length}:${hiddenArtistNames.length}`,
    [
      playlists,
      recentlyPlayedPlaylistIds,
      followedArtists,
      followedAlbums,
      favoriteTracks,
      downloads,
      thumbsUp,
      thumbsDown,
      hiddenTrackIds,
      hiddenArtistNames,
    ]
  );

  const home = useQuery<HomeFeed>({
    queryKey: ['home-feed'],
    queryFn: async () => {
      const feed = await musicApi.getHomeFeed();
      setCachedHome(feed);
      return feed;
    },
    initialData: cachedHome?.data,
    initialDataUpdatedAt: cachedHome?.at,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const localSections = useLocalDigest();

  const personalized = useQuery<PersonalizedHomeFeed>({
    queryKey: ['home-feed-personalized', userId, libraryVersion],
    queryFn: async () => {
      const feed = await musicApi.getPersonalizedHomeFeed(buildLibraryPayload());
      if (userId) setCachedPersonalizedHome(userId, feed);
      return feed;
    },
    initialData: cachedPersonalized?.data,
    initialDataUpdatedAt: cachedPersonalized?.at,
    enabled: signedIn && Boolean(userId),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  /** Final section list: server feed when signed in, local digest as instant/offline
   *  fallback, global feed when signed out. */
  const sections = useMemo(() => {
    if (personalized.data && personalized.data.sections.length > 0) {
      return dedupeSections(personalized.data.sections);
    }
    if (signedIn && localSections.length > 0) {
      return localSections;
    }
    if (home.data) return dedupeSections(globalSections(home.data));
    return [];
  }, [personalized.data, home.data, localSections, signedIn]);

  return {
    home,
    personalized,
    sections,
  };
}
