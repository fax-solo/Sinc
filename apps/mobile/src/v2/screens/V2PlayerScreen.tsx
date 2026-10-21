import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CanonicalTrack } from '@sinc/shared';
import { v2Colors, v2Spacing } from '../theme';
import { V2Text } from '../components/V2Text';
import { V2Screen } from '../components/V2Screen';
import { V2Artwork } from '../components/V2Artwork';
import { V2TrackRow } from '../components/V2TrackRow';
import { V2AddSheet } from '../components/V2AddSheet';
import { V2Error } from '../components/V2State';
import { formatDuration } from '../../utils/format';
import { playerService } from '../../services/player/PlayerService';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { usePlayerProgressStore } from '../../services/player/playerProgressStore';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { shareEntity } from '../../utils/share';
import type { RootStackParamList } from '../../app/navigation/types';

const MAX_UP_NEXT = 5;

function V2SeekBar() {
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const positionMs = usePlayerProgressStore((s) => s.positionMs);
  const durationMs = usePlayerProgressStore((s) => s.durationMs);
  const [width, setWidth] = useState(0);

  const displayDuration = durationMs > 0 ? durationMs : (currentTrack?.durationMs ?? 0);
  const progress = displayDuration > 0 ? Math.min(positionMs / displayDuration, 1) : 0;

  const seek = useCallback(
    (x: number) => {
      if (width <= 0 || displayDuration <= 0) return;
      const ratio = Math.min(Math.max(x / width, 0), 1);
      void playerService.seekTo(Math.round(ratio * displayDuration));
    },
    [width, displayDuration]
  );

  return (
    <View>
      <Pressable
        onPress={(e) => seek(e.nativeEvent.locationX)}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{
          height: 28,
          justifyContent: 'center',
        }}
        accessibilityRole="adjustable"
        accessibilityLabel="Seek"
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          // Screen readers get ±10% of the track instead of tap-coordinates.
          const step = displayDuration * 0.1;
          const forward = e.nativeEvent.actionName === 'increment';
          const target = forward
            ? Math.min(positionMs + step, displayDuration)
            : Math.max(positionMs - step, 0);
          void playerService.seekTo(Math.round(target));
        }}
      >
        <View
          style={{
            height: 5,
            borderRadius: 3,
            backgroundColor: v2Colors.surfaceElevated,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              height: 5,
              width: `${Math.round(progress * 100)}%`,
              backgroundColor: v2Colors.accent,
              borderRadius: 3,
            }}
          />
        </View>
      </Pressable>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <V2Text variant="caption" color="textSecondary">
          {formatDuration(positionMs)}
        </V2Text>
        <V2Text variant="caption" color="textSecondary">
          {formatDuration(displayDuration)}
        </V2Text>
      </View>
    </View>
  );
}

function TrackActions({ track }: { track: CanonicalTrack }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isFavorite = useLibraryStore((s) => s.favoriteIds.has(track.id));
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const isDownloaded = useDownloadsStore((s) => s.downloadedIds.has(track.id));
  const downloadTrack = useDownloadsStore((s) => s.downloadTrack);
  const [sheetVisible, setSheetVisible] = useState(false);

  const action = (name: string, color: string, label: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: v2Colors.surfaceElevated,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={name as never} size={21} color={color} />
    </Pressable>
  );

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: v2Spacing.md }}>
      {action(
        isFavorite ? 'heart' : 'heart-outline',
        isFavorite ? v2Colors.accent : v2Colors.textSecondary,
        isFavorite ? 'Unlike' : 'Like',
        () => toggleFavorite(track)
      )}
      {action('add', v2Colors.textSecondary, 'Add to playlist', () => setSheetVisible(true))}
      {isDownloaded
        ? action('checkmark-circle', v2Colors.accent, 'Downloaded', () => undefined)
        : action(
            'arrow-down-circle-outline',
            v2Colors.textSecondary,
            'Download',
            () => void downloadTrack(track)
          )}
      {action(
        'share-social-outline',
        v2Colors.textSecondary,
        'Share song',
        () =>
          void shareEntity({
            type: 'song',
            id: track.id,
            title: track.title,
            subtitle: track.artists.map((a) => a.name).join(', '),
          })
      )}
      {action('musical-notes-outline', v2Colors.textSecondary, 'Open lyrics', () =>
        navigation.navigate('Lyrics')
      )}
      <V2AddSheet track={track} visible={sheetVisible} onClose={() => setSheetVisible(false)} />
    </View>
  );
}

export function V2PlayerScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const track = usePlayerStore(selectCurrentTrack);
  const status = usePlayerStore((s) => s.status);
  const errorMessage = usePlayerStore((s) => s.errorMessage);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const setRepeat = usePlayerStore((s) => s.setRepeat);

  const playing = status === 'playing';
  const loading = status === 'loading';
  const upNext = queue.slice(currentIndex + 1, currentIndex + 1 + MAX_UP_NEXT);
  // Reactive window size keeps the art sized correctly on fold/rotate.
  const windowWidth = useWindowDimensions().width;
  const artSize = Math.min(windowWidth - v2Spacing.md * 2 - 64, 320);

  const cycleRepeat = () => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off');

  if (!track) {
    return (
      <V2Screen>
        <V2Text variant="body" color="textSecondary" style={{ textAlign: 'center', marginTop: 48 }}>
          Nothing playing yet. Pick a song to get started.
        </V2Text>
      </V2Screen>
    );
  }

  return (
    <V2Screen padded={false} topInset>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: v2Spacing.md,
          paddingBottom: v2Spacing.xxxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={10}
            accessibilityLabel="Close player"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: v2Colors.surfaceElevated,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="chevron-down" size={22} color={v2Colors.textPrimary} />
          </Pressable>
          <V2Text
            variant="caption"
            color="textSecondary"
            style={{ fontWeight: '700' }}
            numberOfLines={1}
          >
            {(track.album?.title ?? 'NOW PLAYING').toUpperCase()}
          </V2Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={{ alignItems: 'center', marginTop: v2Spacing.md }}>
          <View
            style={{
              borderRadius: 12,
              shadowColor: '#000',
              shadowOpacity: 0.5,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 12 },
              elevation: 12,
            }}
          >
            <V2Artwork uri={track.artworkUrl} size={artSize} radius={12} />
          </View>
        </View>

        <View style={{ alignItems: 'center', marginTop: v2Spacing.lg }}>
          <V2Text variant="title" style={{ textAlign: 'center' }} numberOfLines={2}>
            {track.title}
          </V2Text>
          <V2Text variant="body" color="textSecondary" style={{ marginTop: 2 }} numberOfLines={1}>
            {track.artists.map((a) => a.name).join(', ')}
          </V2Text>
        </View>

        {status === 'error' ? (
          <View style={{ marginTop: v2Spacing.sm }}>
            <V2Error message={errorMessage ?? 'Playback failed.'} />
          </View>
        ) : null}

        <View style={{ marginTop: v2Spacing.md }}>
          <V2SeekBar />
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: v2Spacing.lg,
            marginTop: v2Spacing.sm,
          }}
        >
          <Pressable
            onPress={() => toggleShuffle()}
            hitSlop={10}
            accessibilityLabel="Toggle shuffle"
          >
            <Ionicons
              name="shuffle"
              size={22}
              color={shuffle === 'on' ? v2Colors.accent : v2Colors.textMuted}
            />
          </Pressable>
          <Pressable
            onPress={() => void playerService.previous()}
            hitSlop={10}
            accessibilityLabel="Previous"
          >
            <Ionicons name="play-skip-back" size={34} color={v2Colors.textPrimary} />
          </Pressable>
          <Pressable
            onPress={() => void playerService.togglePlayPause()}
            hitSlop={8}
            accessibilityLabel={playing ? 'Pause' : 'Play'}
            style={{
              width: 76,
              height: 76,
              borderRadius: 38,
              // Spotify's play disc is WHITE on the dark canvas.
              backgroundColor: v2Colors.textPrimary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: loading ? 0.7 : 1,
            }}
          >
            <Ionicons
              name={playing ? 'pause' : 'play'}
              size={34}
              color={v2Colors.background}
              style={playing ? undefined : { marginLeft: 4 }}
            />
          </Pressable>
          <Pressable
            onPress={() => void playerService.next()}
            hitSlop={10}
            accessibilityLabel="Next"
          >
            <Ionicons name="play-skip-forward" size={34} color={v2Colors.textPrimary} />
          </Pressable>
          <Pressable onPress={cycleRepeat} hitSlop={10} accessibilityLabel="Cycle repeat mode">
            <View>
              <Ionicons
                name="repeat"
                size={22}
                color={repeat === 'off' ? v2Colors.textMuted : v2Colors.accent}
              />
              {repeat === 'one' ? (
                <V2Text
                  variant="caption"
                  color="accent"
                  style={{ position: 'absolute', end: -6, top: -8, fontWeight: '800' }}
                >
                  1
                </V2Text>
              ) : null}
            </View>
          </Pressable>
        </View>

        <View style={{ marginTop: v2Spacing.lg }}>
          <TrackActions track={track} />
        </View>

        {upNext.length > 0 ? (
          <View style={{ marginTop: v2Spacing.xl }}>
            <V2Text variant="headline" style={{ marginBottom: v2Spacing.xs }}>
              Up next
            </V2Text>
            {upNext.map((t) => (
              <V2TrackRow
                key={t.id}
                track={t}
                showDuration
                onPress={() => {
                  const idx = queue.findIndex((q) => q.id === t.id);
                  if (idx >= 0) {
                    void playerService.playQueue(queue, idx);
                  }
                }}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </V2Screen>
  );
}
