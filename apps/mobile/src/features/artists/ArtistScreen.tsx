import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import type { CanonicalTrack } from '@sinc/shared';
import { AppText } from '../../components/AppText';
import { SongRow } from '../../components/SongRow';
import { AlbumCard } from '../../components/AlbumCard';
import { useTheme } from '../../theme';
import { musicApi } from '../../api/music';
import { playerService } from '../../services/player/PlayerService';
import { shareEntity } from '../../utils/share';
import type { RootStackParamList } from '../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Artist'>;

const TRACK_ROW_HEIGHT = 64;

export function ArtistScreen({ route, navigation }: Props) {
  const { colors, spacing, radii } = useTheme();
  const { id } = route.params;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => musicApi.getArtist(id),
    retry: 1,
  });

  const playTracks = useCallback(
    (tracks: CanonicalTrack[], index: number) => {
      void playerService.playQueue(tracks, index);
      navigation.navigate('Player');
    },
    [navigation]
  );

  const openAlbum = useCallback(
    (albumId: string, title?: string) => {
      navigation.navigate('Album', { id: albumId, title });
    },
    [navigation]
  );

  const share = useCallback(() => {
    if (!data) return;
    void shareEntity({
      type: 'artist',
      id: data.artist.id,
      title: data.artist.name,
      subtitle: 'Artist',
    });
  }, [data]);

  const renderTrack = useCallback(
    ({ item, index }: { item: CanonicalTrack; index: number }) => (
      <SongRow
        track={item}
        showFavorite
        showAdd
        onPress={() => playTracks(data!.topTracks, index)}
      />
    ),
    [data, playTracks]
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.background, flex: 1 }}
      contentContainerStyle={styles.content}
      data={data?.topTracks ?? []}
      renderItem={renderTrack}
      keyExtractor={(track) => track.id}
      getItemLayout={(_, index) => ({
        length: TRACK_ROW_HEIGHT,
        offset: TRACK_ROW_HEIGHT * index,
        index,
      })}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      ListHeaderComponent={
        <>
          {isLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />
          ) : null}

          {isError ? (
            <View style={{ marginTop: spacing.xxl, alignItems: 'center', gap: spacing.md }}>
              <AppText variant="body" color="error" style={{ textAlign: 'center' }}>
                Couldn't load this artist.
              </AppText>
              <Pressable onPress={() => void refetch()}>
                <AppText color="accent">Retry</AppText>
              </Pressable>
            </View>
          ) : null}

          {data ? (
            <View>
              <View style={styles.header}>
                <Image
                  source={data.artist.artworkUrl ? { uri: data.artist.artworkUrl } : undefined}
                  style={[styles.artwork, { borderRadius: radii.full }]}
                />
                <View style={{ flex: 1 }}>
                  <AppText variant="title">{data.artist.name}</AppText>
                  <AppText variant="small" color="textMuted">
                    Artist
                  </AppText>
                </View>
                <Pressable
                  onPress={share}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Share ${data.artist.name}`}
                  style={({ pressed }) => [
                    styles.shareButton,
                    { backgroundColor: colors.surfaceElevated, borderRadius: radii.full },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <AppText variant="bodyLarge" color="textPrimary">
                    Share
                  </AppText>
                </Pressable>
              </View>

              {data.topTracks.length > 0 ? (
                <AppText variant="headline" style={{ marginTop: spacing.xl }}>
                  Top songs
                </AppText>
              ) : null}

              {data.albums.length > 0 ? (
                <View style={{ marginTop: spacing.xxl }}>
                  <AppText variant="headline">Albums</AppText>
                  <FlatList
                    data={data.albums}
                    keyExtractor={(item) => item.id}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: spacing.sm, marginTop: spacing.md }}
                    renderItem={({ item }) => (
                      <AlbumCard album={item} onPress={() => openAlbum(item.id, item.title)} />
                    )}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  artwork: {
    width: 96,
    height: 96,
    backgroundColor: '#222',
  },
  shareButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
