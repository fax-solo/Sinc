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

/**
 * One ordered, deduped Home rail list.
 *
 * Personal mixes lead, then the local rails that make the app feel owned
 * (recently played, playlists, downloads, on repeat), then the remaining
 * personalized recommendations. When personalization is unavailable, local
 * rails are topped up with global charts/starter mixes instead of being
 * replaced by them.
 */
export function composeHomeSections(
  personalized: HomeSection[],
  local: HomeSection[],
  global: HomeSection[]
): HomeSection[] {
  const find = (
    sections: HomeSection[],
    predicate: (section: HomeSection) => boolean
  ): HomeSection | undefined => sections.find(predicate);

  const mixSection =
    find(personalized, (section) => section.kind === 'mixes' && section.mixes.length > 0) ??
    find(global, (section) => section.kind === 'mixes' && section.mixes.length > 0);
  const recentSection =
    find(local, (section) => section.kind === 'recently-played') ??
    find(personalized, (section) => section.kind === 'recently-played');
  const quickSection =
    find(local, (section) => section.kind === 'quick-access') ??
    find(personalized, (section) => section.kind === 'quick-access');
  const savedSection =
    find(local, (section) => section.kind === 'tracks' && section.title === 'Saved for you') ??
    find(
      personalized,
      (section) => section.kind === 'tracks' && section.title === 'Saved for you'
    );
  const repeatSection =
    find(local, (section) => section.kind === 'tracks' && section.title === 'On repeat') ??
    find(
      personalized,
      (section) => section.kind === 'tracks' && section.title === 'On repeat'
    );

  const base = personalized.length > 0 ? personalized : local;
  const rest = base.filter(
    (section) =>
      section.kind !== 'mixes' &&
      section.kind !== 'recently-played' &&
      section.kind !== 'quick-access' &&
      !(
        section.kind === 'tracks' &&
        (section.title === 'Saved for you' || section.title === 'On repeat')
      )
  );

  const ordered = [
    mixSection,
    recentSection,
    quickSection,
    savedSection,
    repeatSection,
    ...rest,
    ...(personalized.length === 0
      ? global.filter((section) => section.kind !== 'mixes')
      : []),
  ].filter((section): section is HomeSection => section != null);

  return dedupeSections(ordered);
}

/**
 * Applies the listener's current hide/thumbs-down feedback to feeds that may
 * have been generated before that feedback existed (cached or in-flight
 * personalization responses). Without this, a stale response could keep
 * recommending a song the listener just rejected until the refetch lands.
 */
export function filterFeedbackSections(
  sections: HomeSection[],
  blockedTrackIds: ReadonlySet<string>,
  hiddenArtistNames: readonly string[]
): HomeSection[] {
  const hiddenArtists = new Set(hiddenArtistNames.map((name) => name.toLowerCase()));
  const keepTrack = (track: { id: string; artists: Array<{ name: string }> }): boolean => {
    if (blockedTrackIds.has(track.id)) return false;
    const lead = track.artists[0]?.name ?? '';
    return !lead || !hiddenArtists.has(lead.toLowerCase());
  };

  const result: HomeSection[] = [];
  for (const section of sections) {
    switch (section.kind) {
      case 'tracks':
      case 'recently-played': {
        const tracks = section.tracks.filter(keepTrack);
        if (tracks.length > 0) result.push({ ...section, tracks });
        break;
      }
      case 'mixes': {
        const mixes = section.mixes
          .map((mix) => {
            const tracks = mix.tracks.filter(keepTrack);
            return { ...mix, tracks, trackCount: tracks.length };
          })
          .filter((mix) => mix.tracks.length > 0);
        if (mixes.length > 0) result.push({ ...section, mixes });
        break;
      }
      case 'albums': {
        const albums = section.albums.filter((album) => {
          const artist = album.artist?.name ?? '';
          return !artist || !hiddenArtists.has(artist.toLowerCase());
        });
        if (albums.length > 0) result.push({ ...section, albums });
        break;
      }
      case 'artists': {
        const artists = section.artists.filter(
          (artist) => !hiddenArtists.has(artist.name.toLowerCase())
        );
        if (artists.length > 0) result.push({ ...section, artists });
        break;
      }
      default:
        result.push(section);
    }
  }
  return result;
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
  const discoveryPreference = useLibraryStore((s) => s.discoveryPreference);
  const completedDownloads = downloads.filter(
    (record) => record.phase === 'completed' && record.localUri
  ).length;
  // Play/skip stats still update constantly, so they stay out of the key.
  // Deliberate feedback (slider, thumbs up→down, hides, likes, downloads)
  // must refresh immediately instead of waiting for a later natural fetch.
  const libraryVersion = useMemo(
    () =>
      `${playlists.length}:${recentlyPlayedPlaylistIds.length}:${followedArtists.length}:${followedAlbums.length}:${favoriteTracks.length}:${downloads.length}:${completedDownloads}:${Object.keys(thumbsUp).length}:${Object.keys(thumbsDown).length}:${hiddenTrackIds.length}:${hiddenArtistNames.length}:${discoveryPreference.toFixed(2)}`,
    [
      playlists,
      recentlyPlayedPlaylistIds,
      followedArtists,
      followedAlbums,
      favoriteTracks,
      downloads,
      completedDownloads,
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

  /** Final ordered rail list, with local and global fallbacks composed in. */
  const blockedTrackIds = useMemo(() => {
    const blocked = new Set(hiddenTrackIds);
    for (const id of Object.keys(thumbsDown)) blocked.add(id);
    return blocked;
  }, [hiddenTrackIds, thumbsDown]);

  const sections = useMemo(() => {
    const global = home.data
      ? filterFeedbackSections(globalSections(home.data), blockedTrackIds, hiddenArtistNames)
      : [];
    const personal = filterFeedbackSections(
      personalized.data?.sections ?? [],
      blockedTrackIds,
      hiddenArtistNames
    );
    return composeHomeSections(personal, localSections, global);
  }, [
    personalized.data,
    home.data,
    localSections,
    blockedTrackIds,
    hiddenArtistNames,
  ]);

  return {
    home,
    personalized,
    sections,
  };
}
