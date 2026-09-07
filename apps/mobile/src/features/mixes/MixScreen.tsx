import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CanonicalTrack } from '@sinc/shared';
import { AppText } from '../../components/AppText';
import { SongRow } from '../../components/SongRow';
import { useTheme } from '../../theme';
import { musicApi } from '../../api/music';
import { getCachedPersonalizedHome } from '../../api/resultCache';
import { useAuthStore } from '../auth/authStore';
import { playerService } from '../../services/player/PlayerService';
import { useLibraryStore } from '../../services/library/libraryStore';
import { recordCollectionPlay } from '../../services/library/sync';
import { shareEntity } from '../../utils/share';
import type { DailyMix } from '../../api/music';
import type { RootStackParamList } from '../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Mix'>;

const TRACK_ROW_HEIGHT = 64;

const EMPTY_LIBRARY = {
  playlists: [],
  recentlyPlayedPlaylistIds: [],
  downloadedTracks: [],
  followedArtists: [],
  followedAlbums: [],
};

/** Resolves a mix id (from a deep link) against the personalized feed. */
function findMix(
  feed: { sections: Array<{ kind: string; mixes?: DailyMix[] }> } | null,
  mixId: string
): DailyMix | null {
  for (const section of feed?.sections ?? []) {
    if (section.kind === 'mixes') {
      const found = section.mixes?.find((m) => m.id === mixId);
      if (found) return found;
    }
  }
  return null;
}

export function MixScreen({ route, navigation }: Props) {
  const { colors, spacing, radii } = useTheme();
  const { mix, mixId } = route.params;
  const userId = useAuthStore((s) => s.user?.id);

  // Resolve the mix synchronously from params or the personalized-feed cache;
  // only the network path runs inside the effect below.
  const phase = useMemo(() => {
    if (mix) return { kind: 'ready', mix } as const;
    if (!mixId) return { kind: 'failed' } as const;
    const cached = findMix(getCachedPersonalizedHome(userId ?? '')?.data ?? null, mixId);
    if (cached) return { kind: 'ready', mix: cached } as const;
    return { kind: 'loading' } as const;
  }, [mix, mixId, userId]);

  const [remoteMix, setRemoteMix] = useState<DailyMix | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (phase.kind !== 'loading') return;
    let cancelled = false;
    void musicApi
      .getPersonalizedHomeFeed(EMPTY_LIBRARY)
      .then((feed) => {
        if (cancelled) return;
        const found = mixId ? findMix(feed, mixId) : null;
        if (found) setRemoteMix(found);
        else setLoadError(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [phase.kind, mixId]);

  const resolved = phase.kind === 'ready' ? phase.mix : remoteMix;
  const loading = phase.kind === 'loading' && !remoteMix;
  const failed = phase.kind === 'failed' || loadError;

  const playAll = useCallback(
    (tracks: CanonicalTrack[], index: number) => {
      if (!resolved) return;
      recordCollectionPlay({
        id: resolved.id,
        type: 'mix',
        title: resolved.name,
        subtitle: resolved.genre,
        artworkUrl: resolved.artworkUrl,
      });
      void playerService.playQueue(tracks, index);
      navigation.navigate('Player');
    },
    [resolved, navigation]
  );

  const share = useCallback(() => {
    if (!resolved) return;
    void shareEntity({
      type: 'mix',
      id: resolved.id,
      title: resolved.name,
      subtitle: resolved.genre,
    });
  }, [resolved]);

  const notInterestedAt = useLibraryStore((s) => s.thumbsDown[resolved?.id ?? '']);

  const notInterested = useCallback(() => {
    if (!resolved) return;
    useLibraryStore.getState().setThumb(resolved.id, notInterestedAt ? 'none' : 'down');
  }, [resolved, notInterestedAt]);

  const renderItem = useCallback(
    ({ item, index }: { item: CanonicalTrack; index: number }) => (
      <SongRow
        track={item}
        showFavorite
        showAdd
        onPress={() => (resolved ? playAll(resolved.tracks, index) : undefined)}
      />
    ),
    [playAll, resolved]
  );

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (failed || !resolved) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
          gap: spacing.md,
        }}
      >
        <AppText variant="body" color="textSecondary" style={{ textAlign: 'center' }}>
          Couldn't load this mix.
        </AppText>
        <Pressable onPress={() => navigation.goBack()}>
          <AppText color="accent">Go back</AppText>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.background, flex: 1 }}
      contentContainerStyle={styles.content}
      data={resolved.tracks}
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
          <View style={styles.header}>
            {resolved.artworkUrl ? (
              <Image
                source={{ uri: resolved.artworkUrl }}
                style={[styles.artwork, { borderRadius: radii.md }]}
              />
            ) : (
              <View
                style={[
                  styles.artwork,
                  styles.placeholder,
                  { borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
                ]}
              >
                <AppText variant="title" color="textSecondary">
                  {resolved.genre.slice(0, 2).toUpperCase()}
                </AppText>
              </View>
            )}
            <View style={{ flex: 1, gap: spacing.xxs }}>
              <AppText variant="title" style={styles.title}>
                {resolved.name}
              </AppText>
              <AppText variant="body" color="textSecondary">
                {resolved.genre}
              </AppText>
              {resolved.description ? (
                <AppText variant="small" color="textMuted">
                  {resolved.description}
                </AppText>
              ) : null}
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
                ▶ Play mix
              </AppText>
            </Pressable>
            <Pressable
              onPress={share}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Share ${resolved.name}`}
              style={[
                styles.shareButton,
                { backgroundColor: colors.surfaceElevated, borderRadius: radii.full },
              ]}
            >
              <AppText variant="bodyLarge" color="textPrimary">
                Share
              </AppText>
            </Pressable>
            <Pressable
              onPress={notInterested}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={
                notInterestedAt ? 'Restore this mix' : "Don't show mixes like this"
              }
              style={[
                styles.shareButton,
                {
                  backgroundColor: notInterestedAt ? colors.error : colors.surfaceElevated,
                  borderRadius: radii.full,
                },
              ]}
            >
              <AppText
                variant="bodyLarge"
                style={{ color: notInterestedAt ? colors.onAccent : colors.textPrimary }}
              >
                {notInterestedAt ? 'Restore' : 'Not interested'}
              </AppText>
            </Pressable>
          </View>
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
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
  },
  playButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  shareButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  pressed: {
    opacity: 0.8,
  },
});
