import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { IconButton, TextButton } from '../components/Buttons';
import { SongRow } from '../components/SongRow';
import { ConfirmDialog, toast } from '../components/Overlays';
import { EmptyState } from '../components/State';
import { colors, spacing } from '../theme';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { playerService } from '../../services/player/PlayerService';
import { openSongMenu } from '../songMenu/songMenuStore';
import { shuffled } from '../../services/local/affinity';
import type { RootStackParamList } from '../../app/navigation/types';

export function RecentlyPlayedScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const tracks = useLibraryStore((state) => state.recentlyPlayed);
  const removeFromHistory = useLibraryStore((state) => state.removeFromHistory);
  const clearHistory = useLibraryStore((state) => state.clearHistory);
  const downloads = useDownloadsStore((state) => state.downloads);
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const playing = usePlayerStore((state) => state.status === 'playing');
  const [clearOpen, setClearOpen] = useState(false);

  const downloadedIds = new Set(
    downloads
      .filter((record) => record.phase === 'completed' && record.localUri)
      .map((record) => record.track.id)
  );

  const play = (index: number, shuffle = false) => {
    if (tracks.length === 0) return;
    void playerService.playQueue(shuffle ? shuffled(tracks, Math.random) : tracks, shuffle ? 0 : index);
  };

  return (
    <Screen padded>
      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: spacing.xxl + insets.bottom }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                paddingTop: spacing.xs,
                marginBottom: spacing.lg,
              }}
            >
              <IconButton
                icon="chevron-back"
                label="Back"
                size={38}
                background={colors.card}
                onPress={() => navigation.goBack()}
              />
              <View style={{ flex: 1 }}>
                <Text variant="headline">Recently played</Text>
                <Text variant="caption">
                  {tracks.length} song{tracks.length === 1 ? '' : 's'} on this device
                </Text>
              </View>
              {tracks.length > 0 ? (
                <IconButton
                  icon="trash-outline"
                  label="Clear listening history"
                  size={38}
                  background={colors.card}
                  color={colors.error}
                  onPress={() => setClearOpen(true)}
                />
              ) : null}
            </View>

            {tracks.length > 0 ? (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'flex-end',
                  gap: spacing.lg,
                  marginBottom: spacing.sm,
                }}
              >
                <TextButton label="Play all" onPress={() => play(0)} />
                <TextButton label="Shuffle" onPress={() => play(0, true)} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="time-outline"
            title="No listening history yet"
            message="Songs you play will show up here, newest first."
            actionLabel="Find music"
            onAction={() => navigation.navigate('Main', { screen: 'Search' })}
          />
        }
        renderItem={({ item, index }) => (
          <SongRow
            track={item}
            downloaded={downloadedIds.has(item.id)}
            isCurrent={currentTrack?.id === item.id}
            isPlaying={playing}
            onPress={() => play(index)}
            onMore={() =>
              openSongMenu(item, {
                sourceLabel: 'Recently played',
                onRemoveFromHistory: () => {
                  removeFromHistory(item.id);
                  toast('Removed from listening history', 'success');
                },
              })
            }
          />
        )}
      />

      <ConfirmDialog
        visible={clearOpen}
        title="Clear listening history?"
        message="This removes recently played songs from Home and History. Your likes, playlists and downloads stay untouched."
        confirmLabel="Clear history"
        destructive
        onCancel={() => setClearOpen(false)}
        onConfirm={() => {
          clearHistory();
          setClearOpen(false);
          toast('Listening history cleared', 'success');
        }}
      />
    </Screen>
  );
}
