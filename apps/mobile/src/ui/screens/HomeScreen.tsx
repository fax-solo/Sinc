import { useMemo } from 'react';
import {
  Pressable,
  RefreshControl,
  View,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import type { CanonicalPlaylist, CanonicalTrack } from '@sinc/shared';
import { Screen, SectionHeader } from '../components/Screen';
import { Text } from '../components/Text';
import { HomeSkeleton, EmptyState, ErrorState, ListSkeleton } from '../components/State';
import { FeaturedCard, MediaCard, ArtistCard, SectionRail } from '../components/Cards';
import { SongRow } from '../components/SongRow';
import { IconButton, TextButton } from '../components/Buttons';
import { colors, radii, spacing } from '../theme';
import { useHomeFeed } from '../../features/home/useHomeFeed';
import { useAuthStore } from '../../features/auth/authStore';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { useUpdateStore } from '../../features/updates/updateStore';
import { useNotificationStore, selectUnreadCount } from '../../features/notifications/notificationStore';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { playerService } from '../../services/player/PlayerService';
import { openSongMenu } from '../songMenu/songMenuStore';
import { playlistArtworkUrl } from '../../components/PlaylistCover';
import type { RootStackParamList } from '../../app/navigation/types';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function visibleRecommendationTracks(
  tracks: CanonicalTrack[],
  blockedTrackIds: ReadonlySet<string>,
  hiddenArtists: ReadonlySet<string>
): CanonicalTrack[] {
  return tracks.filter((track) => {
    if (blockedTrackIds.has(track.id)) return false;
    const lead = (track.artists[0]?.name ?? '').toLowerCase();
    return !lead || !hiddenArtists.has(lead);
  });
}

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const username = useAuthStore((state) => state.user.username);
  const unread = useNotificationStore(selectUnreadCount);
  const { home, personalized, sections } = useHomeFeed();
  const recentlyPlayed = useLibraryStore((state) => state.recentlyPlayed);
  const favoriteTracks = useLibraryStore((state) => state.favoriteTracks);
  const thumbsDown = useLibraryStore((state) => state.thumbsDown);
  const hiddenTrackIds = useLibraryStore((state) => state.hiddenTrackIds);
  const hiddenArtistNames = useLibraryStore((state) => state.hiddenArtistNames);
  const playlists = useLibraryStore((state) => state.playlists);
  const downloads = useDownloadsStore((state) => state.downloads);
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const status = usePlayerStore((state) => state.status);
  const latestRelease = useUpdateStore((state) => state.latest);
  const updateStatus = useUpdateStore((state) => state.softStatus);
  const bannerDismissedFor = useUpdateStore((state) => state.bannerDismissedFor);
  const dismissUpdateBanner = useUpdateStore((state) => state.dismissBanner);

  const mixes = useMemo(
    () => sections.flatMap((section) => (section.kind === 'mixes' ? section.mixes : [])).slice(0, 8),
    [sections]
  );
  const downloadedIds = useMemo(
    () =>
      new Set(
        downloads
          .filter((record) => record.phase === 'completed' && record.localUri)
          .map((record) => record.track.id)
      ),
    [downloads]
  );
  const updateAvailable =
    updateStatus === 'available' &&
    latestRelease != null &&
    bannerDismissedFor !== latestRelease.versionName;

  const blockedTrackIds = useMemo(() => {
    const blocked = new Set(hiddenTrackIds);
    for (const id of Object.keys(thumbsDown)) blocked.add(id);
    return blocked;
  }, [hiddenTrackIds, thumbsDown]);
  const hiddenArtists = useMemo(
    () => new Set(hiddenArtistNames.map((name) => name.toLowerCase())),
    [hiddenArtistNames]
  );
  const visibleRecent = useMemo(
    () => visibleRecommendationTracks(recentlyPlayed, blockedTrackIds, hiddenArtists),
    [recentlyPlayed, blockedTrackIds, hiddenArtists]
  );
  const visibleFavorites = useMemo(
    () => visibleRecommendationTracks(favoriteTracks, blockedTrackIds, hiddenArtists),
    [favoriteTracks, blockedTrackIds, hiddenArtists]
  );

  const featuredMix = mixes.find((mix) => mix.tracks.length > 0);
  const featuredTracks =
    featuredMix?.tracks ??
    (visibleRecent.length > 0
      ? visibleRecent.slice(0, 12)
      : visibleFavorites.slice(0, 12));
  const featuredUri =
    featuredMix?.artworkUrl ??
    featuredTracks[0]?.artworkUrl ??
    visibleFavorites[0]?.artworkUrl;
  const featuredFallback: 'recent' | 'liked' | 'empty' = featuredMix
    ? 'empty'
    : visibleRecent.length > 0
      ? 'recent'
      : visibleFavorites.length > 0
        ? 'liked'
        : 'empty';
  const featuredTitle =
    featuredMix?.name ??
    (featuredFallback === 'recent'
      ? 'Recently played'
      : featuredFallback === 'liked'
        ? 'Liked Songs'
        : 'Your first mix');
  const featuredDescription =
    featuredMix?.description ??
    (featuredFallback === 'recent'
      ? 'Pick up where you left off.'
      : featuredFallback === 'liked'
        ? `${visibleFavorites.length} songs you love, all in one place.`
        : 'Play something and Sinc will start building mixes around you.');
  const featuredPlaying =
    status === 'playing' &&
    currentTrack != null &&
    featuredTracks.some((track) => track.id === currentTrack.id);
  const featuredEmpty = featuredTracks.length === 0;

  const loading = (home.isLoading || personalized.isLoading) && sections.length === 0 && recentlyPlayed.length === 0;
  const errored = sections.length === 0 && recentlyPlayed.length === 0 && home.isError;

  const refresh = () => {
    void home.refetch();
    void personalized.refetch();
  };

  const playTracks = (tracks: CanonicalTrack[], index = 0) => {
    if (tracks.length === 0) return;
    void playerService.playQueue(tracks, index);
  };

  const playFeatured = () => {
    if (featuredMix) {
      playTracks(featuredMix.tracks);
      return;
    }
    if (featuredTracks.length > 0) {
      playTracks(featuredTracks);
      return;
    }
    navigation.navigate('Main', { screen: 'Search' });
  };

  const openFeatured = () => {
    if (featuredMix) {
      navigation.navigate('Mix', { mix: featuredMix });
    } else if (recentlyPlayed.length > 0) {
      navigation.navigate('RecentlyPlayed');
    } else if (favoriteTracks.length > 0) {
      navigation.navigate('Main', { screen: 'Library', params: { category: 'Liked' } });
    }
  };

  const openPlaylist = (playlist: CanonicalPlaylist) => {
    const local = playlists.find((item) => item.id === playlist.id);
    if (local) navigation.navigate('LocalPlaylist', { id: local.id });
    else navigation.navigate('Playlist', { id: playlist.id, name: playlist.name });
  };

  const openTrackMenu = (track: CanonicalTrack) => {
    openSongMenu(track, { sourceLabel: 'Home' });
  };

  if (loading) {
    return (
      <Screen scroll={false} padded={false}>
        <HomeSkeleton />
      </Screen>
    );
  }

  if (errored) {
    return (
      <Screen>
        <ErrorState
          title="Home could not load"
          message={home.error instanceof Error ? home.error.message : 'Check your connection and try again.'}
          onRetry={refresh}
        />
      </Screen>
    );
  }

  const initials = username.slice(0, 1).toUpperCase() || 'S';

  return (
    <Screen scroll padded={false} scrollProps={{ refreshControl: <RefreshControl refreshing={home.isRefetching || personalized.isRefetching} onRefresh={refresh} tintColor={colors.accent} /> }}>
      <View style={{ paddingHorizontal: 20 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: spacing.md,
            paddingTop: spacing.sm,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text variant="micro" style={{ color: colors.textSecondary }}>
              {greeting()}
            </Text>
            <Text variant="display" numberOfLines={1} style={{ marginTop: 3 }}>
              {username === 'you' ? 'Hello, you' : `Hello, ${username}`}
            </Text>
            <Text variant="small" style={{ marginTop: 2 }}>
              Here’s what’s playing for you.
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <View>
              <IconButton
                icon="notifications-outline"
                label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                size={40}
                background={colors.card}
                onPress={() => navigation.navigate('Notifications')}
              />
              {unread > 0 ? (
                <View
                  style={{
                    position: 'absolute',
                    top: -3,
                    right: -3,
                    minWidth: 18,
                    height: 18,
                    paddingHorizontal: 4,
                    borderRadius: 9,
                    backgroundColor: colors.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 9, lineHeight: 12, fontWeight: '800', color: colors.onAccent }}>
                    {unread > 9 ? '9+' : unread}
                  </Text>
                </View>
              ) : null}
            </View>
            <Pressable
              onPress={() => navigation.navigate('Profile')}
              accessibilityRole="button"
              accessibilityLabel="Open profile"
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.accent,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.72 : 1,
              })}
            >
              <Text variant="bodyStrong" style={{ color: colors.onAccent, fontWeight: '800' }}>
                {initials}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={{ height: spacing.xl }} />

        {updateAvailable && latestRelease ? (
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: radii.lg,
              borderWidth: 1,
              borderColor: 'rgba(30,215,96,0.24)',
              padding: spacing.md,
              marginBottom: spacing.lg,
              gap: spacing.sm,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: colors.accentSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="rocket-outline" size={19} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">Sinc {latestRelease.versionName} is available</Text>
                <Text variant="caption" numberOfLines={1}>
                  A new release is ready to download.
                </Text>
              </View>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: spacing.lg,
              }}
            >
              <TextButton
                label="Later"
                color={colors.textSecondary}
                onPress={dismissUpdateBanner}
              />
              <TextButton
                label="View update"
                onPress={() => navigation.navigate('About')}
              />
            </View>
          </View>
        ) : null}

        {featuredEmpty ? (
          <EmptyState
            icon="sparkles-outline"
            title="Your soundtrack starts here"
            message="Search for a song or artist, or download something you love. Sinc builds the rest from what you play."
            actionLabel="Find music"
            onAction={() => navigation.navigate('Main', { screen: 'Search' })}
          />
        ) : (
          <FeaturedCard
            eyebrow={
              featuredMix
                ? 'YOUR VIBE'
                : featuredFallback === 'liked'
                  ? 'YOUR FAVOURITES'
                  : 'PICK UP WHERE YOU LEFT OFF'
            }
            title={featuredTitle}
            description={featuredDescription}
            artworkUri={featuredUri}
            playing={featuredPlaying}
            onPress={openFeatured}
            onPlay={playFeatured}
          />
        )}

        <View style={{ height: spacing.xxl }} />

        {mixes.length > 0 ? (
          <View>
            <SectionHeader
              title="Made for you"
              subtitle="Mixes shaped by your listening"
              actionLabel="See all"
              onAction={() => navigation.navigate('BrowseCategory', { kind: 'made-for-you', title: 'Made for you' })}
            />
            <SectionRail>
              {mixes.map((mix) => (
                <MediaCard
                  key={mix.id}
                  title={mix.name}
                  subtitle={mix.description ?? mix.genre}
                  artworkUri={mix.artworkUrl}
                  onPress={() => navigation.navigate('Mix', { mix })}
                />
              ))}
            </SectionRail>
            <View style={{ height: spacing.xxl }} />
          </View>
        ) : null}

        {sections.map((section, sectionIndex) => {
          if (section.kind === 'mixes') return null;
          const key = `${section.kind}-${section.title}-${sectionIndex}`;
          const isRecent = section.kind === 'recently-played';
          const isQuickAccess = section.kind === 'quick-access';
          const isSaved = section.kind === 'tracks' && section.title === 'Saved for you';
          const actionLabel =
            section.kind === 'albums'
              ? 'Browse'
              : isRecent || isQuickAccess || isSaved
                ? 'See all'
                : undefined;
          const onAction =
            section.kind === 'albums'
              ? () =>
                  navigation.navigate('BrowseCategory', {
                    kind: 'new-releases',
                    title: 'New releases',
                  })
              : isRecent
                ? () => navigation.navigate('RecentlyPlayed')
                : isQuickAccess
                  ? () =>
                      navigation.navigate('Main', {
                        screen: 'Library',
                        params: { category: 'Playlists' },
                      })
                  : isSaved
                    ? () =>
                        navigation.navigate('Main', {
                          screen: 'Library',
                          params: { category: 'Downloads' },
                        })
                    : undefined;

          return (
            <View key={key} style={{ marginBottom: spacing.xxl }}>
              <SectionHeader
                title={section.title}
                subtitle={
                  'explanation' in section
                    ? section.explanation
                    : isQuickAccess
                      ? 'Your collections'
                      : isSaved
                        ? 'Available without a connection'
                        : undefined
                }
                actionLabel={actionLabel}
                onAction={onAction}
              />
              {section.kind === 'recently-played' ? (
                <>
                  {section.tracks.slice(0, 4).map((track) => (
                    <SongRow
                      key={track.id}
                      track={track}
                      isCurrent={currentTrack?.id === track.id}
                      isPlaying={status === 'playing'}
                      downloaded={downloadedIds.has(track.id)}
                      onPress={() =>
                        playTracks(
                          section.tracks,
                          section.tracks.findIndex((item) => item.id === track.id)
                        )
                      }
                      onMore={() => openTrackMenu(track)}
                    />
                  ))}
                </>
              ) : null}
              {section.kind === 'quick-access' ? (
                <SectionRail>
                  {section.playlists.slice(0, 6).map((playlist) => {
                    const local = playlists.find((item) => item.id === playlist.id);
                    return (
                      <MediaCard
                        key={playlist.id}
                        title={playlist.name}
                        subtitle={`${playlist.trackCount} songs`}
                        artworkUri={
                          local?.coverArtworkUrl ??
                          playlistArtworkUrl(local?.tracks ?? []) ??
                          playlist.artworkUrl
                        }
                        onPress={() => openPlaylist(playlist)}
                      />
                    );
                  })}
                </SectionRail>
              ) : null}
              {section.kind === 'tracks' ? (
                <SectionRail>
                  {section.tracks.map((track, index) => (
                    <MediaCard
                      key={track.id}
                      title={track.title}
                      subtitle={track.artists.map((artist) => artist.name).join(', ')}
                      artworkUri={track.artworkUrl}
                      onPress={() => playTracks(section.tracks, index)}
                    />
                  ))}
                </SectionRail>
              ) : null}
              {section.kind === 'albums' ? (
                <SectionRail>
                  {section.albums.map((album) => (
                    <MediaCard
                      key={album.id}
                      title={album.title}
                      subtitle={album.artist?.name}
                      artworkUri={album.artworkUrl}
                      onPress={() =>
                        navigation.navigate('Album', { id: album.id, title: album.title })
                      }
                    />
                  ))}
                </SectionRail>
              ) : null}
              {section.kind === 'artists' ? (
                <SectionRail>
                  {section.artists.map((artist) => (
                    <ArtistCard
                      key={artist.id}
                      name={artist.name}
                      artworkUri={artist.artworkUrl}
                      onPress={() =>
                        navigation.navigate('Artist', { id: artist.id, name: artist.name })
                      }
                    />
                  ))}
                </SectionRail>
              ) : null}
              {section.kind === 'playlists' ? (
                <SectionRail>
                  {section.playlists.map((playlist) => (
                    <MediaCard
                      key={playlist.id}
                      title={playlist.name}
                      subtitle={
                        playlist.trackCount > 0 ? `${playlist.trackCount} songs` : 'Playlist'
                      }
                      artworkUri={playlist.artworkUrl}
                      onPress={() => openPlaylist(playlist)}
                    />
                  ))}
                </SectionRail>
              ) : null}
            </View>
          );
        })}

        {sections.some((section) => section.kind === 'tracks') && home.isFetching ? (
          <View style={{ marginBottom: spacing.xxl }}>
            <ListSkeleton rows={2} />
          </View>
        ) : null}

        {sections.length === 0 && recentlyPlayed.length === 0 && favoriteTracks.length === 0 ? (
          <EmptyState
            icon="radio-outline"
            title="Nothing here yet"
            message="Your recommendations will appear after you play or download some music."
            actionLabel="Explore music"
            onAction={() => navigation.navigate('Main', { screen: 'Search' })}
          />
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.md }}>
          <Ionicons name="leaf-outline" size={13} color={colors.textMuted} />
          <Text variant="caption">Made on your device by Sinc</Text>
        </View>
      </View>
    </Screen>
  );
}
