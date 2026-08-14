import React from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PlaybackState } from '@sinc/shared';
import { useTheme } from '../theme/ThemeProvider';
import { usePlaybackStore } from '../state/playbackStore';

/**
 * Slide-up queue editor: jump to a track, play next, move up/down, remove,
 * clear. Jumping to the current track just closes the sheet.
 */
export default function QueueSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const queue = usePlaybackStore((s) => s.queue);
  const queueIndex = usePlaybackStore((s) => s.queueIndex);
  const playTrack = usePlaybackStore((s) => s.playTrack);
  const moveInQueue = usePlaybackStore((s) => s.moveInQueue);
  const removeFromQueue = usePlaybackStore((s) => s.removeFromQueue);
  const clearQueue = usePlaybackStore((s) => s.clearQueue);
  const status = usePlaybackStore((s) => s.status);

  const jump = (index: number) => {
    if (index === queueIndex) {
      onClose();
      return;
    }
    playTrack(queue[index]!.trackId, queue, index);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={styles.backdropTouch}
          onPress={onClose}
          accessibilityRole="button"
        />
        <View style={[styles.sheet, { backgroundColor: tokens.colors.surface }]}>
          <View style={[styles.handle, { backgroundColor: tokens.colors.outlineVariant }]} />
          <View style={styles.header}>
            <Text style={[tokens.typography.headline, { color: tokens.colors.onSurface }]}>
              {t('player.queue')}
            </Text>
            <TouchableOpacity accessibilityRole="button" onPress={clearQueue}>
              <Text style={[tokens.typography.caption, { color: tokens.colors.error }]}>
                {t('player.clearQueue')}
              </Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={queue}
            keyExtractor={(entry, index) => `${entry.trackId}-${index}`}
            ListEmptyComponent={
              <Text
                style={[
                  tokens.typography.body,
                  styles.empty,
                  { color: tokens.colors.onSurfaceVariant },
                ]}
              >
                {t('player.emptyQueue')}
              </Text>
            }
            renderItem={({ item, index }) => {
              const isCurrent = index === queueIndex;
              return (
                <View style={[styles.row, { backgroundColor: tokens.colors.surfaceContainer }]}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => jump(index)}
                    style={styles.rowMain}
                  >
                    <Text
                      style={[
                        tokens.typography.caption,
                        styles.index,
                        {
                          color: isCurrent ? tokens.colors.primary : tokens.colors.onSurfaceVariant,
                        },
                      ]}
                    >
                      {isCurrent && status === PlaybackState.PLAYING
                        ? '▶'
                        : isCurrent
                          ? '❚❚'
                          : index + 1}
                    </Text>
                    <View style={styles.rowText}>
                      <Text
                        numberOfLines={1}
                        style={[
                          tokens.typography.body,
                          { color: isCurrent ? tokens.colors.primary : tokens.colors.onSurface },
                        ]}
                      >
                        {item.title ?? t('player.unknownTrack')}
                      </Text>
                      {item.artist ? (
                        <Text
                          numberOfLines={1}
                          style={[
                            tokens.typography.caption,
                            { color: tokens.colors.onSurfaceVariant },
                          ]}
                        >
                          {item.artist}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                  <View style={styles.rowActions}>
                    <TextButton
                      label="↑"
                      onPress={() => moveInQueue(index, index - 1)}
                      disabled={index === 0}
                    />
                    <TextButton
                      label="↓"
                      onPress={() => moveInQueue(index, index + 1)}
                      disabled={index === queue.length - 1}
                    />
                    <TextButton
                      label={t('player.playNext')}
                      onPress={() => void playNext(item.trackId)}
                      short
                    />
                    <TextButton label={t('player.remove')} onPress={() => removeFromQueue(index)} />
                  </View>
                </View>
              );
            }}
            style={styles.list}
          />
        </View>
      </View>
    </Modal>
  );
}

function playNext(trackId: string): void {
  usePlaybackStore.getState().addToQueue(trackId, true);
}

function TextButton({
  label,
  onPress,
  disabled = false,
  short = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  short?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.textButton, { opacity: disabled ? tokens.opacity.disabled : 1 }]}
    >
      <Text
        style={[
          tokens.typography.caption,
          { color: disabled ? tokens.colors.onSurfaceVariant : tokens.colors.primary },
          short && styles.shortLabel,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '70%',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  list: {
    flexGrow: 0,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 6,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  index: {
    width: 22,
    textAlign: 'center',
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  textButton: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  shortLabel: {
    fontSize: 9,
  },
});
