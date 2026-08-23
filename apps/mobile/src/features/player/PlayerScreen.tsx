import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import type { CanonicalTrack } from '@sinc/shared';
import { AppText } from '../../components/AppText';
import { AddToPlaylistModal } from '../../components/AddToPlaylistModal';
import { useTheme } from '../../theme';
import { musicApi } from '../../api/music';
import { playerService } from '../../services/player/PlayerService';
import { formatDuration } from '../../components/SongRow';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { usePlayerProgressStore } from '../../services/player/playerProgressStore';
import { useLibraryStore } from '../../services/library/libraryStore';
import { shareEntity } from '../../utils/share';
import type { RootStackParamList } from '../../app/navigation/types';

const MAX_UP_NEXT = 5;

function SeekBar() {
  const { colors, radii } = useTheme();
  const positionMs = usePlayerProgressStore((s) => s.positionMs);
  const durationMs = usePlayerProgressStore((s) => s.durationMs);
  const [width, setWidth] = useState(0);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  const progress = durationMs > 0 ? Math.min(positionMs / durationMs, 1) : 0;

  const seek = useCallback(
    (event: { nativeEvent: { locationX: number } }) => {
      if (width <= 0 || durationMs <= 0) return;
      const ratio = Math.min(Math.max(event.nativeEvent.locationX / width, 0), 1);
      void playerService.seekTo(Math.round(ratio * durationMs));
    },
    [width, durationMs]
  );

  return (
    <View>
      <Pressable onPress={seek} onLayout={onLayout} style={styles.seekTrack}>
        <View
          style={[
            styles.seekFill,
            {
              backgroundColor: colors.accent,
              borderRadius: radii.full,
              width: `${Math.round(progress * 100)}%`,
            },
          ]}
        />
      </Pressable>
      <View style={styles.timesRow}>
        <AppText variant="caption" color="textSecondary">
          {formatDuration(positionMs)}
        </AppText>
        <AppText variant="caption" color="textSecondary">
          {formatDuration(durationMs)}
        </AppText>
      </View>
    </View>
  );
}

function LikeButton({ track }: { track: CanonicalTrack }) {
  const { colors } = useTheme();
  const isFavorite = useLibraryStore((s) => s.favoriteIds.has(track.id));
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);

  return (
    <Pressable
      onPress={() => toggleFavorite(track)}
      hitSlop={8}
      accessibilityLabel={isFavorite ? 'Unlike' : 'Like'}
    >
      <Ionicons
        name={isFavorite ? 'heart' : 'heart-outline'}
        size={24}
        color={isFavorite ? colors.accent : colors.textSecondary}
      />
    </Pressable>
  );
}

function AddToPlaylistButton({ track }: { track: CanonicalTrack }) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);

  return (
    <>
      <Pressable onPress={() => setVisible(true)} hitSlop={8} accessibilityLabel="Add to playlist">
        <Ionicons name="add-circle-outline" size={24} color={colors.textSecondary} />
      </Pressable>
      <AddToPlaylistModal track={track} visible={visible} onClose={() => setVisible(false)} />
    </>
  );
}

function ShareButton({ track }: { track: CanonicalTrack }) {
  const { colors } = useTheme();
  const share = useCallback(() => {
    void shareEntity({
      type: 'song',
      id: track.id,
      title: track.title,
      subtitle: track.artists.map((a) => a.name).join(', '),
    });
  }, [track]);

  return (
    <Pressable
      onPress={share}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Share song"
    >
      <Ionicons name="share-social-outline" size={22} color={colors.textSecondary} />
    </Pressable>
  );
}

type TransportIconName = 'play' | 'pause' | 'next' | 'previous';

function TransportIcon({
  name,
  size,
  color,
}: {
  name: TransportIconName;
  size: number;
  color: string;
}) {
  const triangle = (width: number, height: number) => ({
    width: 0,
    height: 0,
    borderTopWidth: height,
    borderBottomWidth: height,
    borderLeftWidth: width,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: color,
  });

  if (name === 'play') {
    return (
      <View
        style={{
          ...triangle(size * 0.6, size * 0.46),
          marginLeft: size * 0.14,
        }}
      />
    );
  }

  if (name === 'pause') {
    const bar = { width: size * 0.26, height: size * 0.82, borderRadius: size * 0.08 };
    return (
      <View style={{ flexDirection: 'row' }}>
        <View style={{ ...bar, backgroundColor: color }} />
        <View style={{ ...bar, backgroundColor: color, marginLeft: size * 0.24 }} />
      </View>
    );
  }

  const skipBar = (
    <View
      style={{
        width: size * 0.18,
        height: size * 0.7,
        borderRadius: size * 0.05,
        backgroundColor: color,
      }}
    />
  );
  const skipTriangle = <View style={triangle(size * 0.44, size * 0.34)} />;

  if (name === 'next') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {skipBar}
        {skipTriangle}
      </View>
    );
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ transform: [{ rotate: '180deg' }] }}>{skipTriangle}</View>
      {skipBar}
    </View>
  );
}

function ControlButton({
  children,
  onPress,
  accent = false,
  large = false,
}: {
  children: ReactNode;
  onPress: () => void;
  accent?: boolean;
  large?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.controlButton,
        {
          backgroundColor: accent ? colors.accent : 'transparent',
          borderRadius: large ? 40 : 24,
          width: large ? 72 : 48,
          height: large ? 72 : 48,
        },
        pressed && styles.pressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

export function PlayerScreen() {
  const { colors, spacing } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Player'>>();
  const track = usePlayerStore(selectCurrentTrack);
  const status = usePlayerStore((s) => s.status);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const setRepeat = usePlayerStore((s) => s.setRepeat);

  const upNext = useMemo(
    () => queue.slice(currentIndex + 1, currentIndex + 1 + MAX_UP_NEXT),
    [queue, currentIndex]
  );
  const upNextTotal = queue.length - currentIndex - 1;

  const isPlaying = status === 'playing';

  // Deep link (`sinc://song/:id` / `https://sinc.app/song/:id`): load the
  // linked track and start playing it when it isn't already the current one.
  const trackId = route.params?.trackId;
  useEffect(() => {
    if (!trackId || trackId === track?.id) return;
    let cancelled = false;
    void musicApi
      .getTrack(trackId)
      .then(({ track: linked }) => {
        if (cancelled) return;
        void playerService.playQueue([linked], 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [trackId, track?.id]);

  const onPlayPause = useCallback(() => {
    void playerService.togglePlayPause();
  }, []);

  const onNext = useCallback(() => {
    void playerService.next();
  }, []);

  const onPrevious = useCallback(() => {
    void playerService.previous();
  }, []);

  const onToggleRepeat = useCallback(() => {
    const next = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
    setRepeat(next);
  }, [repeat, setRepeat]);

  const repeatLabel = repeat === 'off' ? '↻' : repeat === 'all' ? '↻*' : '↻1';

  if (!track) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <AppText variant="body" color="textSecondary" style={{ textAlign: 'center' }}>
          Nothing playing yet. Pick a song to get started.
        </AppText>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} style={{ flex: 1 }}>
        <Pressable
          onPress={() => navigation.navigate('Lyrics')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="View lyrics"
          style={styles.lyricsButton}
        >
          <Ionicons name="text" size={18} color={colors.textSecondary} />
          <AppText variant="small" color="textSecondary">
            Lyrics
          </AppText>
        </Pressable>

        <Image
          source={track.artworkUrl ? { uri: track.artworkUrl } : undefined}
          style={styles.artwork}
        />

        <View style={{ marginTop: spacing.xl }}>
          <View style={styles.titleRow}>
            <AppText variant="title" numberOfLines={1} style={styles.title}>
              {track.title}
            </AppText>
            {track ? <ShareButton track={track} /> : null}
            {track ? <AddToPlaylistButton track={track} /> : null}
            {track ? <LikeButton track={track} /> : null}
          </View>
          <AppText variant="body" color="textSecondary" numberOfLines={1}>
            {track.artists.map((a) => a.name).join(', ')}
          </AppText>
        </View>

        <SeekBar />

        <View style={styles.controls}>
          <ControlButton onPress={toggleShuffle} accent={shuffle === 'on'}>
            <AppText
              variant="bodyLarge"
              style={{ color: shuffle === 'on' ? colors.onAccent : colors.textPrimary }}
            >
              ⤨
            </AppText>
          </ControlButton>
          <ControlButton onPress={onPrevious}>
            <TransportIcon name="previous" size={22} color={colors.textPrimary} />
          </ControlButton>
          <ControlButton onPress={onPlayPause} accent large>
            <TransportIcon name={isPlaying ? 'pause' : 'play'} size={30} color={colors.onAccent} />
          </ControlButton>
          <ControlButton onPress={onNext}>
            <TransportIcon name="next" size={22} color={colors.textPrimary} />
          </ControlButton>
          <ControlButton onPress={onToggleRepeat} accent={repeat !== 'off'}>
            <AppText
              variant="bodyLarge"
              style={{ color: repeat !== 'off' ? colors.onAccent : colors.textPrimary }}
            >
              {repeatLabel}
            </AppText>
          </ControlButton>
        </View>

        {upNext.length > 0 ? (
          <View style={{ marginTop: spacing.xxl }}>
            <AppText variant="headline">Up next</AppText>
            <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
              {upNext.map((next) => (
                <View key={next.id} style={styles.upNextRow}>
                  <AppText variant="body" numberOfLines={1} style={styles.upNextTitle}>
                    {next.title}
                  </AppText>
                  <AppText variant="caption" color="textMuted">
                    {next.artists[0]?.name ?? ''}
                  </AppText>
                </View>
              ))}
              {upNextTotal > upNext.length ? (
                <AppText variant="caption" color="textMuted">
                  …and {upNextTotal - upNext.length} more in the queue
                </AppText>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  artwork: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#222',
    borderRadius: 16,
  },
  title: {
    flexShrink: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  seekTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: '#333',
    marginTop: 24,
    overflow: 'hidden',
  },
  seekFill: {
    height: '100%',
  },
  timesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginTop: 24,
  },
  controlButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  upNextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  upNextTitle: {
    flex: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  lyricsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'center',
    marginBottom: 16,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
});
