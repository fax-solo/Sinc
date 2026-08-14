import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { CanonicalTrack } from '@sinc/shared';
import { useTheme } from '../theme/ThemeProvider';

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Standard track list row shared by album/artist/playlist screens. */
export default function TrackRow({
  track,
  index,
  onPress,
  subtitle,
  showDuration = true,
}: {
  track: CanonicalTrack;
  index?: number;
  onPress?: () => void;
  subtitle?: string;
  showDuration?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const artists = track.artists.map((a) => a.name).join(', ');
  const body = (
    <>
      {index != null ? (
        <Text
          style={[styles.index, tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}
        >
          {index}
        </Text>
      ) : null}
      <View style={[styles.artworkWrap, { backgroundColor: tokens.colors.surfaceContainerHigh }]}>
        <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
          {(track.album?.title ?? '♪').slice(0, 1)}
        </Text>
      </View>
      <View style={styles.text}>
        <Text
          numberOfLines={1}
          style={[tokens.typography.body, { color: tokens.colors.onSurface }]}
        >
          {track.title}
        </Text>
        <Text
          numberOfLines={1}
          style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}
        >
          {subtitle ?? artists}
        </Text>
      </View>
      {showDuration ? (
        <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
          {formatDuration(track.durationMs)}
        </Text>
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={styles.row}>{body}</View>;
  }
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={styles.row}>
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  index: {
    width: 24,
    textAlign: 'right',
  },
  artworkWrap: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: 1,
  },
});
