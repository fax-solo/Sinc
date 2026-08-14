import React, { useMemo, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Seekable progress bar built on core PanResponder (no slider dependency).
 * Drag anywhere on the bar to seek; fractional position is committed on
 * release (and while dragging for live feedback).
 */
export default function PlayerProgressBar({
  positionMs,
  durationMs,
  onSeek,
}: {
  positionMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const [barWidth, setBarWidth] = useState(0);
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const x = event.nativeEvent.locationX;
          setDragFraction(barWidth > 0 ? clamp01(x / barWidth) : 0);
        },
        onPanResponderMove: (event) => {
          const x = event.nativeEvent.locationX;
          setDragFraction(barWidth > 0 ? clamp01(x / barWidth) : 0);
        },
        onPanResponderRelease: (event) => {
          const x = event.nativeEvent.locationX;
          const fraction = barWidth > 0 ? clamp01(x / barWidth) : 0;
          setDragFraction(null);
          onSeek(fraction * (durationMs || 1));
        },
        onPanResponderTerminate: () => setDragFraction(null),
      }),
    [barWidth, durationMs, onSeek],
  );

  const shownFraction = dragFraction ?? (durationMs > 0 ? positionMs / durationMs : 0);

  return (
    <View style={styles.container}>
      <View
        style={[styles.track, { backgroundColor: tokens.colors.surfaceContainerHigh }]}
        onLayout={(event) => {
          setBarWidth(event.nativeEvent.layout.width);
        }}
        {...panResponder.panHandlers}
      >
        <View
          style={[
            styles.fill,
            {
              width: `${clamp01(shownFraction) * 100}%`,
              backgroundColor: tokens.colors.primary,
            },
          ]}
        />
        <View
          style={[
            styles.thumb,
            {
              left: `${clamp01(shownFraction) * 100}%`,
              backgroundColor: tokens.colors.primary,
            },
          ]}
        />
      </View>
      <View style={styles.times}>
        <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
          {formatMs(positionMs)}
        </Text>
        <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
          {formatMs(durationMs)}
        </Text>
      </View>
    </View>
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  track: {
    height: 24,
    justifyContent: 'center',
    borderRadius: 4,
  },
  fill: {
    height: 4,
    borderRadius: 2,
  },
  thumb: {
    position: 'absolute',
    top: '50%',
    marginTop: -6,
    marginLeft: -6,
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
