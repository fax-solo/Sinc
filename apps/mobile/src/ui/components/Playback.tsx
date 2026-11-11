import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { colors, radii, spacing } from '../theme';
import { Text } from './Text';
import { Artwork } from './Artwork';
import { RoundPlayButton } from './Buttons';
import {
  selectCurrentTrack,
  usePlayerStore,
  type RepeatMode,
  type ShuffleMode,
} from '../../services/player/playerStore';
import { usePlayerProgressStore } from '../../services/player/playerProgressStore';
import { playerService } from '../../services/player/PlayerService';
import type { RootStackParamList } from '../../app/navigation/types';
import { seekRatioFromDrag, seekRatioFromTouch } from './seekMath';

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export function ProgressLine({ color = colors.accent }: { color?: string }) {
  const positionMs = usePlayerProgressStore((state) => state.positionMs);
  const durationMs = usePlayerProgressStore((state) => state.durationMs);
  const ratio = durationMs > 0 ? clamp(positionMs / durationMs, 0, 1) : 0;
  return (
    <View style={{ height: 2, backgroundColor: 'rgba(255,255,255,0.08)' }}>
      <View style={{ width: `${ratio * 100}%`, height: 2, backgroundColor: color }} />
    </View>
  );
}

interface SeekBarProps {
  onSeek: (positionMs: number) => void;
  showThumb?: boolean;
  tint?: string;
  trackColor?: string;
}

export function SeekBar({
  onSeek,
  showThumb = true,
  tint = colors.accent,
  trackColor = colors.border,
}: SeekBarProps) {
  const positionMs = usePlayerProgressStore((state) => state.positionMs);
  const durationMs = usePlayerProgressStore((state) => state.durationMs);
  const [preview, setPreview] = useState<number | null>(null);
  const widthRef = useRef(1);
  const durationRef = useRef(durationMs);
  const previewRef = useRef<number | null>(null);
  /** Gesture start as a 0..1 ratio — drag deltas are pixels, not milliseconds. */
  const dragStartRatioRef = useRef(0);
  /** Guards against a gesture that began before duration/width were known. */
  const dragActiveRef = useRef(false);
  const onSeekRef = useRef(onSeek);

  useEffect(() => {
    durationRef.current = durationMs;
  }, [durationMs]);

  useEffect(() => {
    onSeekRef.current = onSeek;
  }, [onSeek]);

  const updatePreview = (value: number) => {
    previewRef.current = value;
    setPreview(value);
  };

  const clearPreview = () => {
    previewRef.current = null;
    setPreview(null);
  };

  // Gesture handlers only read these refs after mount; creating the responder
  // once keeps an in-flight drag stable across progress re-renders.
  const pan = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // A parent scroll view must not steal an in-flight scrub.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          if (widthRef.current <= 0 || durationRef.current <= 0) {
            dragActiveRef.current = false;
            return;
          }
          dragActiveRef.current = true;
          const ratio = seekRatioFromTouch(
            event.nativeEvent.locationX,
            widthRef.current
          );
          dragStartRatioRef.current = ratio;
          updatePreview(ratio * durationRef.current);
        },
        onPanResponderMove: (_event, gesture) => {
          if (!dragActiveRef.current) return;
          const width = widthRef.current;
          const duration = durationRef.current;
          if (width <= 0 || duration <= 0) return;
          const ratio = seekRatioFromDrag(dragStartRatioRef.current, gesture.dx, width);
          updatePreview(ratio * duration);
        },
        onPanResponderRelease: () => {
          if (!dragActiveRef.current) {
            clearPreview();
            return;
          }
          dragActiveRef.current = false;
          const value = previewRef.current;
          const duration = durationRef.current;
          if (value != null && duration > 0) {
            onSeekRef.current(Math.round(clamp(value, 0, duration)));
          }
          clearPreview();
        },
        onPanResponderTerminate: () => {
          dragActiveRef.current = false;
          clearPreview();
        },
      }),
    []
  );

  const renderValue = preview ?? positionMs;
  const ratio = durationMs > 0 ? clamp(renderValue / durationMs, 0, 1) : 0;

  const adjust = (deltaMs: number) => {
    if (durationMs <= 0) return;
    const next = clamp((preview ?? positionMs) + deltaMs, 0, durationMs);
    setPreview(next);
    onSeek(Math.round(next));
    setPreview(null);
  };

  return (
    <View
      {...pan.panHandlers}
      onLayout={(event) => {
        widthRef.current = Math.max(1, event.nativeEvent.layout.width);
      }}
      accessibilityRole="adjustable"
      accessibilityLabel="Playback position"
      accessibilityValue={{
        min: 0,
        max: Math.max(1, Math.round(durationMs / 1000)),
        now: Math.round(renderValue / 1000),
        text: `${Math.round(renderValue / 1000)} seconds`,
      }}
      accessibilityActions={[
        { name: 'increment', label: 'Seek forward' },
        { name: 'decrement', label: 'Seek backward' },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') adjust(10_000);
        if (event.nativeEvent.actionName === 'decrement') adjust(-10_000);
      }}
      style={{
        height: 28,
        justifyContent: 'center',
        marginVertical: -8,
      }}
    >
      <View
        // Keep touch coordinates relative to the full-width bar even when the
        // finger lands on the fill or thumb.
        pointerEvents="none"
        style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: trackColor,
          overflow: 'visible',
        }}
      >
        <View
          style={{
            width: `${ratio * 100}%`,
            height: 4,
            borderRadius: 2,
            backgroundColor: tint,
          }}
        />
        {showThumb ? (
          <View
            style={{
              position: 'absolute',
              top: -4,
              left: `${ratio * 100}%`,
              width: 12,
              height: 12,
              marginLeft: -6,
              borderRadius: 6,
              backgroundColor: tint,
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

export function PlaybackControls({
  playing,
  loading,
  shuffle,
  repeat,
  onPlay,
  onPrevious,
  onNext,
  onShuffle,
  onRepeat,
  size = 'large',
}: {
  playing: boolean;
  loading: boolean;
  shuffle: ShuffleMode;
  repeat: RepeatMode;
  onPlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
  size?: 'large' | 'compact';
}) {
  const large = size === 'large';
  const side = large ? 42 : 34;
  const playSize = large ? 72 : 48;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: large ? spacing.md : spacing.xs,
      }}
    >
      <Pressable
        onPress={onShuffle}
        accessibilityRole="button"
        accessibilityLabel={shuffle === 'on' ? 'Shuffle on' : 'Shuffle off'}
        accessibilityState={{ selected: shuffle === 'on' }}
        hitSlop={10}
        style={{ width: side, alignItems: 'center' }}
      >
        <Ionicons
          name="shuffle"
          size={large ? 22 : 18}
          color={shuffle === 'on' ? colors.accent : colors.textSecondary}
        />
        {shuffle === 'on' ? <ActiveDot /> : null}
      </Pressable>

      <Pressable
        onPress={onPrevious}
        accessibilityRole="button"
        accessibilityLabel="Previous track"
        hitSlop={10}
        style={{ width: large ? 52 : 42, alignItems: 'center' }}
      >
        <Ionicons name="play-skip-back" size={large ? 28 : 21} color={colors.text} />
      </Pressable>

      <RoundPlayButton
        playing={playing}
        loading={loading}
        onPress={onPlay}
        size={playSize}
        label={playing ? 'Pause' : 'Play'}
      />

      <Pressable
        onPress={onNext}
        accessibilityRole="button"
        accessibilityLabel="Next track"
        hitSlop={10}
        style={{ width: large ? 52 : 42, alignItems: 'center' }}
      >
        <Ionicons name="play-skip-forward" size={large ? 28 : 21} color={colors.text} />
      </Pressable>

      <Pressable
        onPress={onRepeat}
        accessibilityRole="button"
        accessibilityLabel={
          repeat === 'off' ? 'Repeat off' : repeat === 'one' ? 'Repeat one' : 'Repeat all'
        }
        accessibilityState={{ selected: repeat !== 'off' }}
        hitSlop={10}
        style={{ width: side, alignItems: 'center' }}
      >
        <View>
          <Ionicons
            name="repeat"
            size={large ? 22 : 18}
            color={repeat === 'off' ? colors.textSecondary : colors.accent}
          />
          {repeat === 'one' ? (
            <View
              style={{
                position: 'absolute',
                top: -4,
                right: -5,
                minWidth: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: colors.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 8, fontWeight: '900', color: colors.onAccent }}>1</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

function ActiveDot() {
  return (
    <View
      style={{
        width: 3,
        height: 3,
        borderRadius: 2,
        backgroundColor: colors.accent,
        marginTop: 3,
      }}
    />
  );
}

export function MiniPlayer() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const track = usePlayerStore(selectCurrentTrack);
  const status = usePlayerStore((state) => state.status);

  if (!track) return null;
  const playing = status === 'playing';
  const loading = status === 'loading';

  return (
    <View style={{ backgroundColor: colors.backgroundRaised }}>
      <ProgressLine />
      <Pressable
        onPress={() => navigation.navigate('Player')}
        accessibilityRole="button"
        accessibilityLabel={`Open player. ${track.title} by ${track.artists
          .map((artist) => artist.name)
          .join(', ')}`}
        style={({ pressed }) => ({
          height: 58,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Artwork uri={track.artworkUrl} size={44} radius={8} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ color: colors.accent }}>
            {track.title}
          </Text>
          <Text variant="small" numberOfLines={1}>
            {track.artists.map((artist) => artist.name).join(', ')}
          </Text>
        </View>
        <RoundPlayButton
          playing={playing}
          loading={loading}
          onPress={(event) => {
            // The mini-player root opens the Now Playing screen; playback
            // controls inside it must be terminals, not navigation triggers.
            event.stopPropagation();
            void playerService.togglePlayPause();
          }}
          size={38}
          label={playing ? 'Pause' : 'Play'}
        />
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            void playerService.next();
          }}
          accessibilityRole="button"
          accessibilityLabel="Next track"
          hitSlop={8}
          style={{ width: 34, height: 38, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="play-skip-forward" size={20} color={colors.text} />
        </Pressable>
      </Pressable>
    </View>
  );
}

export function PlayerStatusLine({ status }: { status: string }) {
  if (status === 'error') return <Text variant="caption" style={{ color: colors.error }}>Playback error</Text>;
  if (status === 'loading') return <Text variant="caption">Loading audio…</Text>;
  if (status === 'paused') return <Text variant="caption">Paused</Text>;
  return null;
}

/** Compact progress bar for the queue's current row. */
export function MiniProgress({ trackId }: { trackId: string }) {
  const position = usePlayerProgressStore((state) => state.positionMs);
  const duration = usePlayerProgressStore((state) => state.durationMs);
  if (!trackId || duration <= 0) return null;
  const ratio = clamp(position / duration, 0, 1);
  return (
    <View
      style={{
        height: 3,
        borderRadius: 2,
        backgroundColor: colors.border,
        overflow: 'hidden',
        marginTop: spacing.xs,
      }}
    >
      <View
        style={{ width: `${ratio * 100}%`, height: 3, backgroundColor: colors.accent }}
      />
    </View>
  );
}

export const playbackIconSize = { large: radii.full, compact: spacing.lg };
