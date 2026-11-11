import { useMemo } from 'react';
import { RefreshControl, View, useWindowDimensions } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen, SectionHeader } from '../components/Screen';
import { Text } from '../components/Text';
import { IconButton } from '../components/Buttons';
import { MediaCard, ArtistCard, SectionRail, CategoryTile } from '../components/Cards';
import { SongRow } from '../components/SongRow';
import { EmptyState, ErrorState, HomeSkeleton } from '../components/State';
import { colors, spacing } from '../theme';
import { useHomeFeed } from '../../features/home/useHomeFeed';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { playerService } from '../../services/player/PlayerService';
import { openSongMenu } from '../songMenu/songMenuStore';
import type { RootStackParamList } from '../../app/navigation/types';

export function BrowseCategoryScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'BrowseCategory'>) {
  const { kind, title } = route.params;
  const { width } = useWindowDimensions();
  const { home, sections, personalized } = useHomeFeed();
  const playlists = useLibraryStore((state) => state.playlists);
  const downloads = useDownloadsStore((state) => state.downloads);
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const playing = usePlayerStore((state) => state.status === 'playing');
  const cardSize = Math.floor((width - 40 - spacing.sm) / 2);

  const mixes = useMemo(
    () => sections.flatMap((section) => (section.kind === 'mixes' ? section.mixes : [])),
    [sections]
  );
  const moodMixes = useMemo(
    () => (mixes.some((mix) => mix.kind === 'mood') ? mixes.filter((mix) => mix.kind === 'mood') : mixes),
    [mixes]
  );
  const downloadedIds = new Set(
    downloads
      .filter((record) => record.phase === 'completed' && record.localUri)
      .map((record) => record.track.id)
  );

  const feed = home.data;
  const popularTracks = feed?.popularTracks ?? [];
  const newAlbums = feed?.newAlbums ?? [];
  const topArtists = feed?.topArtists ?? [];
  const topPlaylists = feed?.topPlaylists ?? [];
  const mixesLoading =
    kind === 'made-for-you' && personalized.isLoading && mixes.length === 0;
  const mixesError = kind === 'made-for-you' && personalized.isError && mixes.length === 0;
  const loading = mixesLoading || (home.isLoading && !feed && mixes.length === 0);
  const error = mixesError || (home.isError && !feed && mixes.length === 0);
  const errorMessage =
    home.error instanceof Error
      ? home.error.message
      : personalized.error instanceof Error
        ? personalized.error.message
        : 'Check your connection and try again.';

  const playTracks = (tracks: typeof popularTracks, index = 0) => {
    if (tracks.length === 0) return;
    void playerService.playQueue(tracks, index);
  };

  const openPlaylist = (id: string, name: string) => {
    const local = playlists.find((item) => item.id === id);
    if (local) navigation.navigate('LocalPlaylist', { id: local.id });
    else navigation.navigate('Playlist', { id, name });
  };

  const header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingTop: spacing.xs,
        marginBottom: spacing.lg,
      }}
    >
      <IconButton
        icon="chevron-back"
        label="Back"
        size={38}
        background={colors.card}
        onPress={() => navigation.goBack()}
      />
      <View style={{ flex: 1 }}>
        <Text variant="headline" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="caption">Curated from your listening and the charts</Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <Screen padded={false}>
        <View style={{ paddingHorizontal: 20 }}>{header}</View>
        <HomeSkeleton />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        {header}
        <ErrorState
          title={`${title} could not load`}
          message={errorMessage}
          onRetry={() => {
            void home.refetch();
            void personalized.refetch();
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      padded={false}
      scrollProps={{
        refreshControl: (
          <RefreshControl
            refreshing={home.isRefetching || personalized.isRefetching}
            onRefresh={() => {
              void home.refetch();
              void personalized.refetch();
            }}
            tintColor={colors.accent}
          />
        ),
      }}
    >
      <View style={{ paddingHorizontal: 20 }}>{header}</View>

      {kind === 'made-for-you' ? (
        mixes.length > 0 ? (
          <View style={{ paddingHorizontal: 20 }}>
            <SectionHeader title="Your mixes" subtitle="Recomputed as you play" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {mixes.map((mix) => (
                <MediaCard
                  key={mix.id}
                  title={mix.name}
                  subtitle={mix.description ?? mix.genre}
                  artworkUri={mix.artworkUrl}
                  width={cardSize}
                  size={cardSize}
                  onPress={() => navigation.navigate('Mix', { mix })}
                />
              ))}
            </View>
            <View style={{ height: spacing.xxl }} />
          </View>
        ) : (
          <EmptyState
            icon="sparkles-outline"
            title="No mixes yet"
            message="Play a few songs and Sinc will shape mixes around your taste."
            actionLabel="Find music"
            onAction={() => navigation.navigate('Main', { screen: 'Search' })}
          />
        )
      ) : null}

      {kind === 'charts' ? (
        <View>
          {popularTracks.length > 0 ? (
            <View style={{ paddingHorizontal: 20, marginBottom: spacing.xl }}>
              <SectionHeader title="Top songs" subtitle="Popular right now" />
              {popularTracks.map((track, index) => (
                <SongRow
                  key={track.id}
                  track={track}
                  showIndex={index + 1}
                  downloaded={downloadedIds.has(track.id)}
                  isCurrent={currentTrack?.id === track.id}
                  isPlaying={playing}
                  onPress={() => playTracks(popularTracks, index)}
                  onMore={() => openSongMenu(track, { sourceLabel: 'Charts' })}
                />
              ))}
            </View>
          ) : null}

          {topArtists.length > 0 ? (
            <View style={{ marginBottom: spacing.xl }}>
              <View style={{ paddingHorizontal: 20 }}>
                <SectionHeader title="Top artists" />
              </View>
              <View style={{ paddingHorizontal: 20 }}>
                <SectionRail>
                  {topArtists.map((artist) => (
                    <ArtistCard
                      key={artist.id}
                      name={artist.name}
                      artworkUri={artist.artworkUrl}
                      onPress={() => navigation.navigate('Artist', { id: artist.id, name: artist.name })}
                    />
                  ))}
                </SectionRail>
              </View>
            </View>
          ) : null}

          {topPlaylists.length > 0 ? (
            <View style={{ marginBottom: spacing.xxl }}>
              <View style={{ paddingHorizontal: 20 }}>
                <SectionHeader title="Top playlists" />
              </View>
              <View style={{ paddingHorizontal: 20 }}>
                <SectionRail>
                  {topPlaylists.map((playlist) => (
                    <MediaCard
                      key={playlist.id}
                      title={playlist.name}
                      subtitle={playlist.trackCount > 0 ? `${playlist.trackCount} songs` : 'Playlist'}
                      artworkUri={playlist.artworkUrl}
                      onPress={() => openPlaylist(playlist.id, playlist.name)}
                    />
                  ))}
                </SectionRail>
              </View>
            </View>
          ) : null}

          {popularTracks.length === 0 && topArtists.length === 0 && topPlaylists.length === 0 ? (
            <EmptyState
              icon="trending-up"
              title="Charts are quiet"
              message="The providers did not return any chart data. Try again in a moment."
              actionLabel="Refresh"
              onAction={() => void home.refetch()}
            />
          ) : null}
        </View>
      ) : null}

      {kind === 'new-releases' ? (
        newAlbums.length > 0 ? (
          <View style={{ paddingHorizontal: 20 }}>
            <SectionHeader title="Fresh albums" subtitle="New from the catalog" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {newAlbums.map((album) => (
                <MediaCard
                  key={album.id}
                  title={album.title}
                  subtitle={album.artist.name}
                  artworkUri={album.artworkUrl}
                  width={cardSize}
                  size={cardSize}
                  onPress={() => navigation.navigate('Album', { id: album.id, title: album.title })}
                />
              ))}
            </View>
            <View style={{ height: spacing.xxl }} />
          </View>
        ) : (
          <EmptyState
            icon="disc-outline"
            title="No new releases"
            message="The providers did not return new albums right now."
            actionLabel="Refresh"
            onAction={() => void home.refetch()}
          />
        )
      ) : null}

      {kind === 'moods' ? (
        <View>
          <View style={{ paddingHorizontal: 20, marginBottom: spacing.xl }}>
            <SectionHeader title="Pick a mood" subtitle="We’ll find real songs for it" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {['Chill', 'Focus', 'Workout', 'Late night', 'Feel good', 'Acoustic'].map(
                (mood, index) => (
                  <View key={mood} style={{ width: cardSize }}>
                    <CategoryTile
                      title={mood}
                      subtitle="Search songs"
                      colors={
                        index % 2 === 0 ? ['#145A35', '#1ED760'] : ['#28402F', '#4E7A58']
                      }
                      icon={<Ionicons name="musical-notes" size={24} color="rgba(255,255,255,0.5)" />}
                      onPress={() =>
                        navigation.navigate('Main', {
                          screen: 'Search',
                          params: { query: mood },
                        })
                      }
                    />
                  </View>
                )
              )}
            </View>
          </View>

          {moodMixes.length > 0 ? (
            <View style={{ paddingHorizontal: 20 }}>
              <SectionHeader title="Mood mixes" subtitle="From your recent listening" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {moodMixes.map((mix) => (
                  <MediaCard
                    key={mix.id}
                    title={mix.name}
                    subtitle={mix.genre}
                    artworkUri={mix.artworkUrl}
                    width={cardSize}
                    size={cardSize}
                    onPress={() => navigation.navigate('Mix', { mix })}
                  />
                ))}
              </View>
              <View style={{ height: spacing.xxl }} />
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}
