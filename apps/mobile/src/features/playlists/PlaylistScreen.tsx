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
import { useLibraryStore } from '../../services/library/libraryStore';
import type { RootStackParamList } from '../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Playlist'>;

const TRACK_ROW_HEIGHT = 64;

export function PlaylistScreen({ route, navigation }: Props) {
  const { colors, spacing, radii } = useTheme();
  const { id } = route.params;
  const localPlaylist = useLibraryStore((s) => s.playlists.find((p) => p.id === id));

  // Local playlists (from the Home quick-access section / library) are stored
  // on the device; only server playlists are resolved through the API.
  const local = localPlaylist ? { playlist: localPlaylist, tracks: localPlaylist.tracks } : null;
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => musicApi.getPlaylist(id),
    enabled: !local,
    retry: 1,
  });

  const playAll = useCallback(
    (tracks: CanonicalTrack[], index: number) => {
      if (!tracks || tracks.length === 0) return;
      if (local) useLibraryStore.getState().recordPlaylistPlayed(local.playlist.id);
      if (data) {
        recordCollectionPlay({
          id: data.playlist.id,
          type: 'playlist',
          title: data.playlist.name,
          subtitle: data.playlist.owner.name,
          artworkUrl: data.playlist.artworkUrl,
        });
      }
      void playerService.playQueue(tracks, index);
      navigation.navigate('Player');
    },
    [navigation, local, data]
  );

  const resolved = local ?? data;
  const displayPlaylist = resolved
    ? {
        name: resolved.playlist.name,
        artworkUrl: 'artworkUrl' in resolved.playlist ? resolved.playlist.artworkUrl : undefined,
        ownerName: 'owner' in resolved.playlist ? resolved.playlist.owner.name : 'You',
      }
    : null;

  const share = useCallback(() => {
    if (!resolved || !displayPlaylist) return;
    void shareEntity({
      type: 'playlist',
      id: resolved.playlist.id,
      title: displayPlaylist.name,
      subtitle: displayPlaylist.ownerName,
    });
  }, [resolved, displayPlaylist]);

  const renderItem = useCallback(
    ({ item, index }: { item: CanonicalTrack; index: number }) => (
      <SongRow
        track={item}
        showFavorite
        showAdd
        showDownload
        onPress={() => playAll(resolved!.tracks, index)}
      />
    ),
    [playAll, resolved]
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.background, flex: 1 }}
      contentContainerStyle={styles.content}
      data={resolved?.tracks ?? []}
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
      ListEmptyComponent={
        resolved && !isLoading ? (
          <AppText variant="body" color="textSecondary" style={{ marginTop: spacing.lg }}>
            No tracks yet. Use "Add to playlist" on any song.
          </AppText>
        ) : null
      }
      ListHeaderComponent={
        <>
          {!local && isLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />
          ) : null}

          {!local && isError ? (
            <View style={{ marginTop: spacing.xxl, alignItems: 'center', gap: spacing.md }}>
              <AppText variant="body" color="error" style={{ textAlign: 'center' }}>
                Couldn't load this playlist.
              </AppText>
              <Pressable onPress={() => void refetch()}>
                <AppText color="accent">Retry</AppText>
              </Pressable>
            </View>
          ) : null}

          {resolved && displayPlaylist ? (
            <View>
              <View style={styles.header}>
                <Image
                  source={
                    displayPlaylist.artworkUrl ? { uri: displayPlaylist.artworkUrl } : undefined
                  }
                  style={[styles.artwork, { borderRadius: radii.md }]}
                />
                <View style={{ flex: 1, gap: spacing.xxs }}>
                  <AppText variant="title" style={styles.title}>
                    {displayPlaylist.name}
                  </AppText>
                  <AppText variant="body" color="textSecondary">
                    {displayPlaylist.ownerName}
                  </AppText>
                  <AppText variant="small" color="textMuted">
                    {resolved.tracks.length} songs
                  </AppText>
                </View>
              </View>

              <View style={styles.actions}>
                <Pressable
                  onPress={() => playAll(resolved.tracks, 0)}
                  style={({ pressed }) => [
                    styles.playButton,
                    { backgroundColor: colors.accent, borderRadius: radii.full },
                    pressed && styles.pressed,
                  ]}
                >
                  <AppText variant="bodyLarge" style={{ color: colors.onAccent }}>
                    ▶ Play playlist
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
