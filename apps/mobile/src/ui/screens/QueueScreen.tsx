import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { Artwork } from '../components/Artwork';
import { IconButton, PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Fields';
import { MiniProgress } from '../components/Playback';
import { BottomSheet, ConfirmDialog, toast } from '../components/Overlays';
import { EmptyState } from '../components/State';
import { colors, radii, spacing } from '../theme';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { playerService } from '../../services/player/PlayerService';
import { useLibraryStore } from '../../services/library/libraryStore';
import { openSongMenu } from '../songMenu/songMenuStore';
import type { RootStackParamList } from '../../app/navigation/types';

export function QueueScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const queue = usePlayerStore((state) => state.queue);
  const currentIndex = usePlayerStore((state) => state.currentIndex);
  const status = usePlayerStore((state) => state.status);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const current = usePlayerStore(selectCurrentTrack);
  const addPlaylist = useLibraryStore((state) => state.addPlaylist);

  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [clearOpen, setClearOpen] = useState(false);

  const upcoming = queue.slice(currentIndex + 1);
  const played = queue.slice(0, Math.max(0, currentIndex));

  const saveQueue = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addPlaylist(trimmed, queue);
    setSaveOpen(false);
    setName('');
    toast('Queue saved as a playlist', 'success');
  };

  const header = (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xs }}>
        <IconButton
          icon="chevron-down"
          label="Close queue"
          size={38}
          background={colors.card}
          onPress={() => navigation.goBack()}
        />
        <View style={{ flex: 1 }}>
          <Text variant="headline">Queue</Text>
          <Text variant="caption">
            {queue.length} song{queue.length === 1 ? '' : 's'}
            {shuffle === 'on' ? ' · Shuffle on' : ''}
          </Text>
        </View>
        <IconButton
          icon="shuffle"
          label={shuffle === 'on' ? 'Turn shuffle off' : 'Turn shuffle on'}
          size={38}
          color={shuffle === 'on' ? colors.accent : colors.text}
          background={shuffle === 'on' ? colors.accentSoft : colors.card}
          onPress={() => playerService.setShuffle(shuffle !== 'on')}
        />
        <IconButton
          icon="save-outline"
          label="Save queue as playlist"
          size={38}
          background={colors.card}
          disabled={queue.length === 0}
          onPress={() => setSaveOpen(true)}
        />
        <IconButton
          icon="trash-outline"
          label="Clear queue"
          size={38}
          background={colors.card}
          color={queue.length === 0 ? colors.textMuted : colors.error}
          disabled={queue.length === 0}
          onPress={() => setClearOpen(true)}
        />
      </View>

      {queue.length > 0 ? (
        <View style={{ marginTop: spacing.lg }}>
          <Text variant="micro" style={{ marginBottom: spacing.xs }}>
            NOW PLAYING
          </Text>
          {current ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                backgroundColor: colors.accentSoft,
                borderRadius: radii.md,
                padding: spacing.sm,
              }}
            >
              <Artwork uri={current.artworkUrl} size={54} radius={8} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" numberOfLines={1} style={{ color: colors.accent }}>
                  {current.title}
                </Text>
                <Text variant="small" numberOfLines={1}>
                  {current.artists.map((artist) => artist.name).join(', ')}
                </Text>
                <MiniProgress trackId={current.id} />
              </View>
              <Pressable
                onPress={() => void playerService.togglePlayPause()}
                accessibilityRole="button"
                accessibilityLabel={status === 'playing' ? 'Pause' : 'Play'}
                style={({ pressed }) => ({
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: colors.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <Ionicons
                  name={status === 'playing' ? 'pause' : 'play'}
                  size={18}
                  color={colors.onAccent}
                  style={status === 'playing' ? undefined : { marginLeft: 2 }}
                />
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {upcoming.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: spacing.lg,
            marginBottom: spacing.xs,
          }}
        >
          <Text variant="micro">NEXT UP</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Text variant="caption" style={{ color: colors.textMuted }}>
              {upcoming.length} waiting
            </Text>
            <Pressable
              onPress={() => playerService.setShuffle(shuffle !== 'on')}
              accessibilityRole="button"
              accessibilityLabel={shuffle === 'on' ? 'Turn shuffle off' : 'Turn shuffle on for upcoming songs'}
              style={{ paddingVertical: 4 }}
            >
              <Text
                variant="caption"
                style={{ color: shuffle === 'on' ? colors.accent : colors.textMuted, fontWeight: '700' }}
              >
                {shuffle === 'on' ? 'Shuffle on' : 'Shuffle'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen padded>
      <FlatList
        data={upcoming}
        keyExtractor={(track, index) => `${track.id}-${index}`}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: spacing.xxl + insets.bottom }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => {
          const absoluteIndex = currentIndex + 1 + index;
          return (
            <Pressable
              onPress={() => void playerService.jumpToQueueIndex(absoluteIndex)}
              accessibilityRole="button"
              accessibilityLabel={`Play ${item.title} by ${item.artists.map((artist) => artist.name).join(', ')}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                paddingVertical: 7,
                opacity: pressed ? 0.68 : 1,
              })}
            >
              <Text variant="caption" style={{ width: 20, textAlign: 'center' }}>
                {absoluteIndex + 1}
              </Text>
              <Artwork uri={item.artworkUrl} size={46} radius={7} />
              <View style={{ flex: 1, gap: 1 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {item.title}
                </Text>
                <Text variant="small" numberOfLines={1}>
                  {item.artists.map((artist) => artist.name).join(', ')}
                </Text>
              </View>
              <Pressable
                onPress={(event) => {
                  event.stopPropagation();
                  openSongMenu(item, {
                    sourceLabel: 'In your queue',
                    onRemoveFromQueue: () => {
                      // Resolve against the live queue: playback may have
                      // advanced while this menu was open.
                      const live = usePlayerStore.getState();
                      const index = live.queue.findIndex(
                        (candidate, candidateIndex) =>
                          candidateIndex > live.currentIndex && candidate.id === item.id
                      );
                      const removed =
                        index >= 0 ? playerService.removeFromQueue(index) : false;
                      toast(
                        removed ? 'Removed from queue' : 'That song is no longer in the queue',
                        removed ? 'success' : 'default'
                      );
                    },
                    onMoveUp:
                      absoluteIndex > currentIndex + 1
                        ? () => playerService.reorderQueue(absoluteIndex, absoluteIndex - 1)
                        : undefined,
                    onMoveDown:
                      absoluteIndex < queue.length - 1
                        ? () => playerService.reorderQueue(absoluteIndex, absoluteIndex + 1)
                        : undefined,
                  })
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Queue options for ${item.title}`}
                style={({ pressed }) => ({
                  width: 30,
                  height: 38,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.55 : 1,
                })}
              >
                <Ionicons name="ellipsis-vertical" size={18} color={colors.textMuted} />
              </Pressable>
            </Pressable>
          );
        }}
        ListFooterComponent={
          queue.length === 0 ? (
            <EmptyState
              icon="list-outline"
              title="Your queue is empty"
              message="Choose a song and use “Add to queue” to line up what comes next."
              actionLabel="Find music"
              onAction={() => navigation.navigate('Main', { screen: 'Search' })}
            />
          ) : played.length > 0 ? (
            <View style={{ marginTop: spacing.xl }}>
              <Text variant="micro" style={{ marginBottom: spacing.xs }}>
                PLAYED
              </Text>
              {played.slice(-5).reverse().map((track, index) => (
                <Pressable
                  key={`played-${track.id}-${index}`}
                  onPress={() => void playerService.jumpToQueueIndex(currentIndex - 1 - index)}
                  accessibilityRole="button"
                  accessibilityLabel={`Play ${track.title} again`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    paddingVertical: 6,
                    opacity: pressed ? 0.55 : 0.5,
                  })}
                >
                  <Ionicons name="time-outline" size={16} color={colors.textMuted} />
                  <Text variant="small" numberOfLines={1} style={{ flex: 1 }}>
                    {track.title}
                  </Text>
                  <Text variant="caption">
                    {track.artists[0]?.name ?? ''}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null
        }
      />

      <BottomSheet
        visible={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save queue as playlist"
        subtitle={`${queue.length} songs will be copied into a new playlist.`}
      >
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <Field
            label="Playlist name"
            value={name}
            onChangeText={setName}
            placeholder="My queue"
            autoFocus
            maxLength={80}
            returnKeyType="done"
            onSubmitEditing={saveQueue}
          />
          <PrimaryButton
            label="Save playlist"
            onPress={saveQueue}
            disabled={!name.trim() || queue.length === 0}
          />
        </View>
      </BottomSheet>

      <ConfirmDialog
        visible={clearOpen}
        title="Clear the queue?"
        message="Playback will stop and every song will be removed from the queue."
        confirmLabel="Clear queue"
        destructive
        onCancel={() => setClearOpen(false)}
        onConfirm={() => {
          setClearOpen(false);
          void playerService.clearQueue().then(() => toast('Queue cleared', 'success'));
        }}
      />
    </Screen>
  );
}
