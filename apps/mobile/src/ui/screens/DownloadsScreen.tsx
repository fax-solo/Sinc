import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { Artwork } from '../components/Artwork';
import { IconButton, TextButton } from '../components/Buttons';
import { SongRow } from '../components/SongRow';
import { ConfirmDialog, toast } from '../components/Overlays';
import { EmptyState, Pill } from '../components/State';
import { colors, radii, spacing } from '../theme';
import {
  isDownloadInProgress,
  useDownloadsStore,
  type DownloadRecord,
} from '../../services/library/downloadsStore';
import { useDownloadProgressStore } from '../../services/library/downloadProgressStore';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { playerService } from '../../services/player/PlayerService';
import { openSongMenu } from '../songMenu/songMenuStore';
import { shuffled } from '../../services/local/affinity';
import { formatBytes } from '../../utils/format';
import type { RootStackParamList } from '../../app/navigation/types';

export function DownloadsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const downloads = useDownloadsStore((state) => state.downloads);
  const pausedIds = useDownloadsStore((state) => state.pausedIds);
  const pauseDownload = useDownloadsStore((state) => state.pauseDownload);
  const resumeDownload = useDownloadsStore((state) => state.resumeDownload);
  const retryDownload = useDownloadsStore((state) => state.retryDownload);
  const removeDownload = useDownloadsStore((state) => state.removeDownload);
  const liveProgress = useDownloadProgressStore((state) => state.progress);
  const liveIndeterminate = useDownloadProgressStore((state) => state.indeterminate);
  const liveSpeeds = useDownloadProgressStore((state) => state.speeds);
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const playing = usePlayerStore((state) => state.status === 'playing');
  const [pendingRemove, setPendingRemove] = useState<DownloadRecord | null>(null);

  const active = downloads.filter((record) => isDownloadInProgress(record.phase));
  const failed = downloads.filter((record) => record.phase === 'failed');
  const completed = useMemo(
    () =>
      downloads
        .filter((record) => record.phase === 'completed' && record.localUri)
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
    [downloads]
  );
  const completedTracks = completed.map((record) => record.track);
  const totalBytes = completed.reduce((sum, record) => sum + (record.sizeBytes ?? 0), 0);

  const playAll = (shuffle = false) => {
    if (completedTracks.length === 0) return;
    void playerService.playQueue(
      shuffle ? shuffled(completedTracks, Math.random) : completedTracks,
      0
    );
  };

  const retry = (record: DownloadRecord) => {
    // The store resolves retry when the entire transfer finishes. Queueing
    // begins synchronously, so acknowledge immediately and let the row's
    // live progress show the outcome.
    const pending = retryDownload(record.jobId);
    toast('Download retried', 'success');
    void pending.catch((error: unknown) => {
      toast(error instanceof Error ? error.message : 'Retry failed', 'error');
    });
  };

  const togglePause = async (record: DownloadRecord) => {
    const paused = pausedIds.has(record.jobId);
    try {
      if (paused) {
        const pending = resumeDownload(record.jobId);
        toast('Download resumed', 'success');
        void pending.catch(() => toast('Could not resume download', 'error'));
      } else {
        await pauseDownload(record.jobId);
        toast('Download paused', 'default');
      }
    } catch {
      toast(paused ? 'Could not resume download' : 'Could not pause download', 'error');
    }
  };

  const header = (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingTop: spacing.xs,
          marginBottom: spacing.sm,
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
          <Text variant="headline">Downloads</Text>
          <Text variant="caption">
            {completed.length} saved · {formatBytes(totalBytes)}
          </Text>
        </View>
      </View>

      {active.length > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <Text variant="micro" style={{ marginBottom: spacing.xs }}>
            IN PROGRESS · {active.length}
          </Text>
          {active.map((record) => {
            const paused = pausedIds.has(record.jobId);
            const percent = Math.max(0, liveProgress[record.jobId] ?? record.progress);
            const speed = liveSpeeds[record.jobId];
            const indeterminate = liveIndeterminate[record.jobId] === true;
            const status = paused
              ? 'Paused'
              : record.phase === 'queued'
                ? 'Queued'
                : record.error
                  ? record.error
                  : record.phase === 'source'
                    ? 'Finding source'
                    : indeterminate
                      ? `Downloading…${speed ? ` · ${speed}` : ''}`
                      : `${Math.round(percent)}%${speed ? ` · ${speed}` : ''}`;
            return (
              <View
                key={record.jobId}
                style={{
                  backgroundColor: colors.card,
                  borderRadius: radii.md,
                  padding: spacing.sm,
                  marginBottom: spacing.xs,
                  gap: spacing.sm,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Artwork uri={record.track.artworkUrl} size={46} radius={7} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {record.track.title}
                    </Text>
                    <Text variant="caption" numberOfLines={1}>
                      {record.track.artists.map((artist) => artist.name).join(', ')} · {status}
                    </Text>
                  </View>
                  <IconButton
                    icon={paused ? 'play' : 'pause'}
                    label={paused ? 'Resume download' : 'Pause download'}
                    size={36}
                    background={colors.backgroundRaised}
                    onPress={() => void togglePause(record)}
                  />
                  <IconButton
                    icon="close"
                    label="Cancel download"
                    size={36}
                    background={colors.backgroundRaised}
                    color={colors.error}
                    onPress={() => setPendingRemove(record)}
                  />
                </View>
                {indeterminate && !paused ? (
                  <View style={{ height: 14, justifyContent: 'center' }}>
                    <ActivityIndicator size="small" color={colors.accent} />
                  </View>
                ) : (
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.border }}>
                    <View
                      style={{
                        width: `${Math.min(100, Math.max(2, percent))}%`,
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: paused ? colors.textMuted : colors.accent,
                      }}
                    />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ) : null}

      {failed.length > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <Text variant="micro" style={{ marginBottom: spacing.xs }}>
            NEEDS ATTENTION · {failed.length}
          </Text>
          {failed.map((record) => (
            <View
              key={record.jobId}
              style={{
                backgroundColor: 'rgba(255, 91, 101, 0.08)',
                borderRadius: radii.md,
                padding: spacing.sm,
                marginBottom: spacing.xs,
                gap: spacing.xs,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Artwork uri={record.track.artworkUrl} size={46} radius={7} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {record.track.title}
                  </Text>
                  <Text variant="small" style={{ color: colors.error }} numberOfLines={2}>
                    {record.error ?? 'The download failed.'}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md }}>
                <TextButton
                  label="Remove"
                  color={colors.textSecondary}
                  onPress={() => setPendingRemove(record)}
                />
                <TextButton label="Retry" onPress={() => retry(record)} />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {completed.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: spacing.lg,
            marginBottom: spacing.xs,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Text variant="micro">OFFLINE MUSIC</Text>
            <Pill label="Ready" tone="accent" />
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <TextButton label="Play" onPress={() => playAll(false)} />
            <TextButton label="Shuffle" onPress={() => playAll(true)} />
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen padded>
      <FlatList
        data={completed}
        keyExtractor={(item) => item.jobId}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: spacing.xxl + insets.bottom }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          active.length === 0 && failed.length === 0 ? (
            <EmptyState
              icon="cloud-download-outline"
              title="Nothing downloaded"
              message="Download songs to keep them on this device and play them without a connection."
              actionLabel="Find music"
              onAction={() => navigation.navigate('Main', { screen: 'Search' })}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <SongRow
            track={item.track}
            downloaded
            subtitle={`${item.track.artists.map((artist) => artist.name).join(', ')} · ${formatBytes(
              item.sizeBytes ?? 0
            )}`}
            isCurrent={currentTrack?.id === item.track.id}
            isPlaying={playing}
            onPress={() => {
              const index = completedTracks.findIndex((track) => track.id === item.track.id);
              void playerService.playQueue(completedTracks, Math.max(0, index));
            }}
            onMore={() => openSongMenu(item.track, { sourceLabel: 'Downloaded' })}
          />
        )}
      />

      <ConfirmDialog
        visible={pendingRemove != null}
        title={pendingRemove?.phase === 'completed' ? 'Remove download?' : 'Cancel download?'}
        message={
          pendingRemove?.phase === 'completed'
            ? 'The downloaded audio will be deleted from this device. The song stays in your library.'
            : 'The partial download and its temporary files will be removed.'
        }
        confirmLabel={pendingRemove?.phase === 'completed' ? 'Remove' : 'Cancel download'}
        destructive
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          const record = pendingRemove;
          setPendingRemove(null);
          if (!record) return;
          void removeDownload(record.jobId)
            .then(() =>
              toast(
                record.phase === 'completed' ? 'Download removed' : 'Download cancelled',
                'success'
              )
            )
            .catch(() => toast('Could not remove the download', 'error'));
        }}
      />
    </Screen>
  );
}
