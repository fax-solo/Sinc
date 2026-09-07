import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
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

/** Dedupes items across sections so nothing repeats on the page. */
function dedupeSections(sections: HomeSection[]): HomeSection[] {
  const seenTracks = new Set<string>();
  const seenAlbums = new Set<string>();
  const seenArtists = new Set<string>();
  const seenPlaylists = new Set<string>();
  const result: HomeSection[] = [];

  for (const section of sections) {
    let next = section;
    switch (section.kind) {
      case 'tracks': {
        const tracks = section.tracks.filter((t) => {
          if (seenTracks.has(t.id)) return false;
          seenTracks.add(t.id);
          return true;
        });
        if (tracks.length === 0) continue;
        next = { ...section, tracks };
        break;
      }
      case 'recently-played': {
        const tracks = section.tracks.filter((t) => {
          if (seenTracks.has(t.id)) return false;
          seenTracks.add(t.id);
          return true;
        });
        if (tracks.length === 0) continue;
        next = { ...section, tracks };
        break;
      }
      case 'albums': {
        const albums = section.albums.filter((a) => {
          if (seenAlbums.has(a.id)) return false;
          seenAlbums.add(a.id);
          return true;
        });
        if (albums.length === 0) continue;
        next = { ...section, albums };
        break;
      }
      case 'artists': {
        const artists = section.artists.filter((a) => {
          if (seenArtists.has(a.id)) return false;
          seenArtists.add(a.id);
          return true;
        });
        if (artists.length === 0) continue;
        next = { ...section, artists };
        break;
      }
      case 'playlists':
      case 'quick-access': {
        const playlists = section.playlists.filter((p) => {
          if (seenPlaylists.has(p.id)) return false;
          seenPlaylists.add(p.id);
          return true;
        });
        if (playlists.length === 0) continue;
        next = { ...section, playlists };
        break;
      }
      case 'mixes':
        break;
    }
    result.push(next);
  }
  return result;
}

export function useHomeFeed() {
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id);
  const signedIn = status === 'signedIn';
  const cachedHome = getCachedHome();
  const cachedPersonalized = userId ? getCachedPersonalizedHome(userId) : null;

  const playlists = useLibraryStore((s) => s.playlists);
  const recentlyPlayedPlaylistIds = useLibraryStore((s) => s.recentlyPlayedPlaylistIds);
  const followedArtists = useLibraryStore((s) => s.followedArtists);
  const followedAlbums = useLibraryStore((s) => s.followedAlbums);
  const downloads = useDownloadsStore((s) => s.downloads);
  const playStats = useLibraryStore((s) => s.playStats);
  const skipStats = useLibraryStore((s) => s.skipStats);
  const thumbsUp = useLibraryStore((s) => s.thumbsUp);
  const thumbsDown = useLibraryStore((s) => s.thumbsDown);
  const hiddenTrackIds = useLibraryStore((s) => s.hiddenTrackIds);
  const hiddenArtistNames = useLibraryStore((s) => s.hiddenArtistNames);
  const discoveryPreference = useLibraryStore((s) => s.discoveryPreference);
  const libraryVersion = useMemo(
    () =>
      `${playlists.length}:${recentlyPlayedPlaylistIds.length}:${followedArtists.length}:${followedAlbums.length}:${downloads.length}:${Object.keys(playStats).length}:${Object.keys(skipStats).length}:${Object.keys(thumbsUp).length + Object.keys(thumbsDown).length}:${hiddenTrackIds.length}:${hiddenArtistNames.length}:${discoveryPreference.toFixed(2)}`,
    [
      playlists,
      recentlyPlayedPlaylistIds,
      followedArtists,
      followedAlbums,
      downloads,
      playStats,
      skipStats,
      thumbsUp,
      thumbsDown,
      hiddenTrackIds,
      hiddenArtistNames,
      discoveryPreference,
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
