import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PlaybackState, type RepeatMode, type ShuffleMode } from '@sinc/shared';
import { useTheme } from '../theme/ThemeProvider';
import Artwork from '../components/Artwork';
import ActionChip from '../components/ActionChip';
import PlayerProgressBar from '../components/PlayerProgressBar';
import QueueSheet from '../components/QueueSheet';
import { usePlaybackStore } from '../state/playbackStore';
import type { RootStackParamList } from '../navigation/types';

export default function PlayerScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [queueOpen, setQueueOpen] = useState(false);

  const status = usePlaybackStore((s) => s.status);
  const currentTrackId = usePlaybackStore((s) => s.currentTrackId);
  const track = usePlaybackStore((s) =>
    currentTrackId ? s.tracksById[currentTrackId] : undefined,
  );
  const positionMs = usePlaybackStore((s) => s.positionMs);
  const durationMs = usePlaybackStore((s) => s.durationMs);
  const shuffle = usePlaybackStore((s) => s.shuffle);
  const repeat = usePlaybackStore((s) => s.repeat);
  const togglePlay = usePlaybackStore((s) => s.togglePlay);
  const next = usePlaybackStore((s) => s.next);
  const previous = usePlaybackStore((s) => s.previous);
  const seekTo = usePlaybackStore((s) => s.seekTo);
  const setShuffle = usePlaybackStore((s) => s.setShuffle);
  const setRepeat = usePlaybackStore((s) => s.setRepeat);
  const retry = usePlaybackStore((s) => s.retry);

  const isPlaying = status === PlaybackState.PLAYING;
  const isError = status === PlaybackState.ERROR;
  const title = track?.title ?? t('player.unknownTrack');
  const subtitle = track?.artist ?? t('player.unknownArtist');

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <View style={styles.artworkWrap}>
        <Artwork label={title} size={260} radius={24} />
      </View>

      <View style={styles.info}>
        <Text
          numberOfLines={2}
          style={[tokens.typography.title1, { color: tokens.colors.onBackground }]}
        >
          {title}
        </Text>
        <Text
          numberOfLines={1}
          style={[tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}
        >
          {subtitle}
        </Text>
      </View>

      <PlayerProgressBar positionMs={positionMs} durationMs={durationMs} onSeek={seekTo} />

      <View style={styles.controls}>
        <ShuffleButton mode={shuffle} onPress={setShuffle} />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('player.previous')}
          onPress={previous}
          style={styles.control}
        >
          <Text style={[tokens.typography.title1, { color: tokens.colors.onBackground }]}>⏮</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? t('player.pause') : t('player.play')}
          onPress={togglePlay}
          style={[styles.playButton, { backgroundColor: tokens.colors.primary }]}
        >
          <Text style={[tokens.typography.title1, { color: tokens.colors.onPrimary }]}>
            {isPlaying ? '❚❚' : '▶'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('player.next')}
          onPress={next}
          style={styles.control}
        >
          <Text style={[tokens.typography.title1, { color: tokens.colors.onBackground }]}>⏭</Text>
        </TouchableOpacity>
        <RepeatButton mode={repeat} onPress={setRepeat} />
      </View>

      {isError ? (
        <View style={styles.errorWrap}>
          <Text style={[tokens.typography.caption, { color: tokens.colors.error }]}>
            {t('player.errorBody')}
          </Text>
          <ActionChip label={t('common.retry')} onPress={retry} />
        </View>
      ) : null}

      <View style={styles.footer}>
        <ActionChip label={t('player.queue')} onPress={() => setQueueOpen(true)} />
        <ActionChip
          label={t('player.lyrics')}
          onPress={() => navigation.navigate('LyricsScreen')}
        />
        <ActionChip label={t('player.favorite')} onPress={() => undefined} disabled />
      </View>

      <QueueSheet visible={queueOpen} onClose={() => setQueueOpen(false)} />
    </View>
  );
}

function ShuffleButton({
  mode,
  onPress,
}: {
  mode: ShuffleMode;
  onPress: (mode: ShuffleMode) => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const active = mode !== 'OFF';
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => onPress(active ? 'OFF' : 'ON')}
      style={styles.control}
    >
      <Text
        style={[
          tokens.typography.title1,
          { color: active ? tokens.colors.primary : tokens.colors.onSurfaceVariant },
        ]}
      >
        ⤨
      </Text>
    </TouchableOpacity>
  );
}

function RepeatButton({
  mode,
  onPress,
}: {
  mode: RepeatMode;
  onPress: (mode: RepeatMode) => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const active = mode !== 'OFF';
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => onPress(mode === 'OFF' ? 'ALL' : mode === 'ALL' ? 'ONE' : 'OFF')}
      style={styles.control}
    >
      <Text
        style={[
          tokens.typography.title1,
          { color: active ? tokens.colors.primary : tokens.colors.onSurfaceVariant },
        ]}
      >
        {mode === 'ONE' ? '🔂' : '🔁'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 24,
    gap: 24,
  },
  artworkWrap: {
    alignItems: 'center',
    marginTop: 24,
  },
  info: {
    gap: 4,
    alignItems: 'center',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  control: {
    padding: 10,
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorWrap: {
    alignItems: 'center',
    gap: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 'auto',
  },
});
