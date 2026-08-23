import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import type { CanonicalTrack } from '@sinc/shared';
import { AppText } from '../../components/AppText';
import { SongRow } from '../../components/SongRow';
import { useTheme } from '../../theme';
import { musicApi } from '../../api/music';
import { playerService } from '../../services/player/PlayerService';
import { recordCollectionPlay } from '../../services/library/sync';
import { shareEntity } from '../../utils/share';
import type { RootStackParamList } from '../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Album'>;

const TRACK_ROW_HEIGHT = 64;

export function AlbumScreen({ route, navigation }: Props) {
  const { colors, spacing, radii } = useTheme();
  const { id } = route.params;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['album', id],
    queryFn: () => musicApi.getAlbum(id),
    retry: 1,
  });

  const playAll = useCallback(
    (tracks: CanonicalTrack[], index: number) => {
      if (data) {
        recordCollectionPlay({
          id: data.album.id,
          type: 'album',
          title: data.album.title,
          subtitle: data.album.artist.name,
          artworkUrl: data.album.artworkUrl,
        });
      }
      void playerService.playQueue(tracks, index);
      navigation.navigate('Player');
    },
    [data, navigation]
  );

  const share = useCallback(() => {
    if (!data) return;
    void shareEntity({
      type: 'album',
      id: data.album.id,
      title: data.album.title,
      subtitle: data.album.artist.name,
    });
  }, [data]);

  const renderItem = useCallback(
    ({ item, index }: { item: CanonicalTrack; index: number }) => (
      <SongRow track={item} showFavorite showAdd onPress={() => playAll(data!.tracks, index)} />
    ),
    [data, playAll]
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.background, flex: 1 }}
      contentContainerStyle={styles.content}
      data={data?.tracks ?? []}
      renderItem={renderItem}
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
                Couldn't load this album.
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
                  source={data.album.artworkUrl ? { uri: data.album.artworkUrl } : undefined}
                  style={[styles.artwork, { borderRadius: radii.md }]}
                />
                <View style={{ flex: 1, gap: spacing.xxs }}>
                  <AppText variant="title" style={styles.title}>
                    {data.album.title}
                  </AppText>
                  <AppText variant="body" color="textSecondary">
                    {data.album.artist.name} · {data.album.type}
                  </AppText>
                  <AppText variant="small" color="textMuted">
                    {data.album.year ? String(data.album.year) : ''}
                    {data.album.trackCount > 0 ? ` · ${data.album.trackCount} songs` : ''}
                  </AppText>
                </View>
              </View>

              <View style={styles.actions}>
                <Pressable
                  onPress={() => playAll(data.tracks, 0)}
                  style={({ pressed }) => [
                    styles.playButton,
                    { backgroundColor: colors.accent, borderRadius: radii.full },
                    pressed && styles.pressed,
                  ]}
                >
                  <AppText variant="bodyLarge" style={{ color: colors.onAccent }}>
                    ▶ Play album
                  </AppText>
                </Pressable>
                <Pressable
                  onPress={share}
                  style={({ pressed }) => [
                    styles.shareButton,
                    { backgroundColor: colors.surfaceElevated, borderRadius: radii.full },
                    pressed && styles.pressed,
                  ]}
                >
                  <AppText variant="bodyLarge" color="textPrimary">
                    Share
                  </AppText>
                </Pressable>
              </View>
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
    width: 128,
    height: 128,
    backgroundColor: '#222',
  },
  title: {
    flexShrink: 1,
  },
  playButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  shareButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
  },
  pressed: {
    opacity: 0.8,
  },
});
