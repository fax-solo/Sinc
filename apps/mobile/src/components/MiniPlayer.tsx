import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlaybackState } from '@sinc/shared';
import { useTheme } from '../theme/ThemeProvider';
import { usePlaybackStore } from '../state/playbackStore';
import type { RootStackParamList } from '../navigation/types';

/**
 * Compact now-playing bar floating above the tab bar. Visible whenever a
 * queue exists; tap to open the full player.
 */
export default function MiniPlayer(): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const visible = usePlaybackStore((s) => s.isMiniPlayerVisible);
  const currentTrackId = usePlaybackStore((s) => s.currentTrackId);
  const status = usePlaybackStore((s) => s.status);
  const track = usePlaybackStore((s) =>
    currentTrackId ? s.tracksById[currentTrackId] : undefined,
  );
  const togglePlay = usePlaybackStore((s) => s.togglePlay);
  const next = usePlaybackStore((s) => s.next);

  if (!visible || !currentTrackId) return null;

  const isPlaying = status === PlaybackState.PLAYING;
  const title = track?.title ?? t('player.unknownTrack');
  const subtitle = track?.artist ?? t('player.unknownArtist');

  return (
    <View
      style={[
        styles.wrap,
        { bottom: 56 + insets.bottom, backgroundColor: tokens.colors.surfaceContainerHigh },
      ]}
    >
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('player.openPlayer')}
        onPress={() => navigation.navigate('FullPlayer')}
        style={styles.main}
      >
        <View style={[styles.artwork, { backgroundColor: tokens.colors.primaryContainer }]}>
          <Text style={[tokens.typography.caption, { color: tokens.colors.onPrimaryContainer }]}>
            {title.slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={styles.text}>
          <Text
            numberOfLines={1}
            style={[tokens.typography.body, { color: tokens.colors.onSurface }]}
          >
            {title}
          </Text>
          <Text
            numberOfLines={1}
            style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}
          >
            {subtitle}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? t('player.pause') : t('player.play')}
        onPress={togglePlay}
        style={styles.control}
      >
        <Text style={[tokens.typography.title1, { color: tokens.colors.primary }]}>
          {isPlaying ? '❚❚' : '▶'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('player.next')}
        onPress={next}
        style={styles.control}
      >
        <Text style={[tokens.typography.title1, { color: tokens.colors.primary }]}>⏭</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  artwork: {
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
  control: {
    paddingHorizontal: 8,
  },
});
