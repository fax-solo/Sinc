import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'react-native-linear-gradient';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Artwork } from '../components/Artwork';
import { Text } from '../components/Text';
import { IconButton } from '../components/Buttons';
import { PlaybackControls, SeekBar } from '../components/Playback';
import { ConfirmDialog, BottomSheet, SheetRow, toast } from '../components/Overlays';
import { EmptyState } from '../components/State';
import { colors, radii, spacing } from '../theme';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { usePlayerProgressStore } from '../../services/player/playerProgressStore';
import { playerService } from '../../services/player/PlayerService';
import { useLibraryStore } from '../../services/library/libraryStore';
import { isDownloadInProgress, useDownloadsStore } from '../../services/library/downloadsStore';
import { openSongMenu } from '../songMenu/songMenuStore';
import { formatDuration } from '../../utils/format';
import { shareEntity } from '../../utils/share';
import { musicApi } from '../../api/music';
import { nativeBridge } from '../../services/native';
import type { AudioOutputDevice } from '../../services/native/types';
import type { RootStackParamList } from '../../app/navigation/types';

export function PlayerScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Player'>>();
  const deepLinkId = route.params?.trackId;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const track = usePlayerStore(selectCurrentTrack);
  const status = usePlayerStore((state) => state.status);
  const queue = usePlayerStore((state) => state.queue);
  const errorMessage = usePlayerStore((state) => state.errorMessage);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const repeat = usePlayerStore((state) => state.repeat);
  const positionMs = usePlayerProgressStore((state) => state.positionMs);
  const durationMs = usePlayerProgressStore((state) => state.durationMs);
  const favoriteIds = useLibraryStore((state) => state.favoriteIds);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const downloads = useDownloadsStore((state) => state.downloads);
  const downloadTrack = useDownloadsStore((state) => state.downloadTrack);
  const retryDownload = useDownloadsStore((state) => state.retryDownload);
  const removeDownload = useDownloadsStore((state) => state.removeDownload);

  const [confirmRemove, setConfirmRemove] = useState(false);
  const [outputSheet, setOutputSheet] = useState(false);
  const [outputs, setOutputs] = useState<AudioOutputDevice[]>([]);
  const [outputsLoading, setOutputsLoading] = useState(false);

  // `sinc://song/<id>` links load and play the linked track. The param is
  // consumed so reopening the player from the mini player does not replay it.
  useEffect(() => {
    if (!deepLinkId) return;
    const state = usePlayerStore.getState();
    if (state.queue[state.currentIndex]?.id === deepLinkId) {
      navigation.setParams({ trackId: undefined });
      return;
    }
    let cancelled = false;
    void musicApi
      .getTrack(deepLinkId)
      .then(({ track: linked }) => {
        if (cancelled) return;
        void playerService.playTrack(linked);
        navigation.setParams({ trackId: undefined });
      })
      .catch(() => {
        if (cancelled) return;
        navigation.setParams({ trackId: undefined });
        toast('That song could not be opened', 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [deepLinkId, navigation]);

  const artSize = useMemo(
    () => Math.max(180, Math.min(width - 64, height * 0.34, 380)),
    [width, height]
  );

  if (!track) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <View style={{ paddingHorizontal: spacing.md, flexDirection: 'row' }}>
          <IconButton
            icon="chevron-down"
            label="Close player"
            size={42}
            background={colors.card}
            onPress={() => navigation.goBack()}
          />
        </View>
        <EmptyState
          icon="musical-notes-outline"
          title="Nothing playing"
          message="Pick a song from Home, Search or your Library and it will appear here."
          actionLabel="Find music"
          onAction={() => navigation.navigate('Main', { screen: 'Search' })}
        />
      </View>
    );
  }

  const favorite = favoriteIds.has(track.id);
  const download = downloads.find((record) => record.track.id === track.id);
  const downloaded = download?.phase === 'completed' && Boolean(download.localUri);
  const downloading = download ? isDownloadInProgress(download.phase) : false;
  const playing = status === 'playing';
  const loading = status === 'loading';
  const artist = track.artists[0];
  const displayDuration = durationMs > 0 ? durationMs : track.durationMs;
  const source = track.providerIds.deezer ? 'Deezer' : track.providerIds.itunes ? 'iTunes' : 'Sinc';
  const error = status === 'error' ? (errorMessage ?? 'This track could not be played.') : null;

  const refreshOutputs = () =>
    nativeBridge.audioOutput
      .getOutputs()
      .then((devices) => setOutputs(Array.from(devices)))
      .catch(() => toast('Could not list audio outputs', 'error'));

  const openOutputSheet = () => {
    if (!nativeBridge.audioOutput.available()) {
      toast('Audio output switching is unavailable on this device', 'error');
      return;
    }
    setOutputSheet(true);
    setOutputsLoading(true);
    void refreshOutputs().finally(() => setOutputsLoading(false));
  };

  const selectOutput = (deviceId: number, automatic: boolean) => {
    void nativeBridge.audioOutput
      .setOutput(deviceId)
      .then((ok) => {
        if (!ok) throw new Error('no playback session');
        toast(automatic ? 'Audio output set to automatic' : 'Audio output switched', 'success');
        return refreshOutputs();
      })
      .catch(() => toast('Could not switch audio output', 'error'));
  };

  const handleDownload = () => {
    if (downloaded) {
      setConfirmRemove(true);
      return;
    }
    if (downloading) {
      navigation.navigate('Downloads');
      return;
    }
    // Both store actions resolve only when the whole transfer completes.
    // Queueing is synchronous, so give immediate feedback instead of making
    // the button look unresponsive for the download's full duration.
    const failedDownload = download?.phase === 'failed' ? download : null;
    const pending = failedDownload ? retryDownload(failedDownload.jobId) : downloadTrack(track);
    toast(failedDownload ? 'Download retried' : 'Download started', 'success');
    void pending.catch((caught: unknown) => {
      toast(caught instanceof Error ? caught.message : 'Could not start download', 'error');
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <LinearGradient
        colors={['#1C2A23', colors.background, colors.background]}
        locations={[0, 0.48, 1]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '70%' }}
      />
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + spacing.xs,
          paddingBottom: insets.bottom + spacing.sm,
          paddingHorizontal: spacing.lg,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.sm,
          }}
        >
          <IconButton
            icon="chevron-down"
            label="Close player"
            size={40}
            background="rgba(255,255,255,0.08)"
            onPress={() => navigation.goBack()}
          />
          <View style={{ alignItems: 'center', flex: 1 }}>
            <Text variant="micro" style={{ color: colors.textSecondary }}>
              NOW PLAYING
            </Text>
            <Text variant="caption" numberOfLines={1} style={{ marginTop: 2 }}>
              {source} · {queue.length} song{queue.length === 1 ? '' : 's'} in queue
            </Text>
          </View>
          <IconButton
            icon="ellipsis-horizontal"
            label="Song options"
            size={40}
            background="rgba(255,255,255,0.08)"
            onPress={() => openSongMenu(track, { sourceLabel: 'Now playing' })}
          />
        </View>

        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Artwork
            uri={track.artworkUrl}
            size={artSize}
            radius={radii.lg}
            accessibilityLabel={`${track.title} artwork`}
            style={{
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.07)',
              shadowColor: '#000',
              shadowOpacity: 0.5,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 16 },
              elevation: 14,
            }}
          />
        </View>

        <View style={{ gap: spacing.md }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: spacing.md,
            }}
          >
            <View style={{ flex: 1, gap: 3 }}>
              <Text variant="title" numberOfLines={2}>
                {track.title}
              </Text>
              <Pressable
                onPress={() => {
                  if (!artist) return;
                  navigation.navigate('Artist', { id: artist.id, name: artist.name });
                }}
                accessibilityRole="button"
                accessibilityLabel={`Go to ${artist?.name ?? 'artist'}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  alignSelf: 'flex-start',
                }}
              >
                <Text variant="bodyLarge" color="textSecondary" numberOfLines={1}>
                  {track.artists.map((item) => item.name).join(', ')}
                </Text>
                {track.explicit ? (
                  <View
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 3,
                      backgroundColor: colors.textMuted,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 9,
                        lineHeight: 12,
                        fontWeight: '900',
                        color: colors.background,
                      }}
                    >
                      E
                    </Text>
                  </View>
                ) : null}
              </Pressable>
              {track.album?.id ? (
                <Pressable
                  onPress={() =>
                    navigation.navigate('Album', {
                      id: track.album?.id ?? '',
                      title: track.album?.title,
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Go to album ${track.album.title}`}
                  style={{ alignSelf: 'flex-start' }}
                >
                  <Text variant="caption" numberOfLines={1}>
                    {track.album.title}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <IconButton
                icon={favorite ? 'heart' : 'heart-outline'}
                label={favorite ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
                size={42}
                color={favorite ? colors.accent : colors.text}
                onPress={() => {
                  toggleFavorite(track);
                  toast(favorite ? 'Removed from Liked Songs' : 'Added to Liked Songs', 'success');
                }}
              />
              <IconButton
                icon={
                  downloaded
                    ? 'checkmark-circle'
                    : downloading
                      ? 'cloud-download'
                      : download?.phase === 'failed'
                        ? 'refresh'
                        : 'download-outline'
                }
                label={
                  downloaded
                    ? 'Downloaded, remove download'
                    : downloading
                      ? 'Download in progress'
                      : download?.phase === 'failed'
                        ? 'Retry download'
                        : 'Download song'
                }
                size={42}
                color={downloaded ? colors.accent : downloading ? colors.accentBright : colors.text}
                onPress={handleDownload}
              />
            </View>
          </View>

          {error ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                backgroundColor: 'rgba(255, 91, 101, 0.12)',
                borderRadius: radii.md,
                padding: spacing.sm,
              }}
            >
              <Ionicons name="warning-outline" size={18} color={colors.error} />
              <Text variant="small" style={{ color: colors.error, flex: 1 }}>
                {error}
              </Text>
              <Pressable
                onPress={() => void playerService.retry()}
                accessibilityRole="button"
                accessibilityLabel="Retry playback"
                style={{ paddingHorizontal: spacing.sm, paddingVertical: 5 }}
              >
                <Text variant="small" style={{ color: colors.error, fontWeight: '800' }}>
                  Retry
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View>
            <SeekBar onSeek={(value) => void playerService.seekTo(value)} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
              <Text variant="caption">{formatDuration(positionMs)}</Text>
              <Text variant="caption">
                {displayDuration > 0
                  ? `-${formatDuration(Math.max(0, displayDuration - positionMs))}`
                  : '--:--'}
              </Text>
            </View>
          </View>

          <PlaybackControls
            playing={playing}
            loading={loading}
            shuffle={shuffle}
            repeat={repeat}
            onPlay={() => void playerService.togglePlayPause()}
            onPrevious={() => void playerService.previous()}
            onNext={() => void playerService.next()}
            onShuffle={() => playerService.setShuffle(shuffle !== 'on')}
            onRepeat={() => {
              const next = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
              playerService.setRepeatMode(next);
            }}
          />

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: spacing.sm,
              borderTopWidth: 1,
              borderTopColor: colors.borderSoft,
              paddingTop: spacing.sm,
            }}
          >
            <FooterButton
              icon="mic-outline"
              label="Lyrics"
              onPress={() => navigation.navigate('Lyrics')}
            />
            <FooterButton
              icon="list"
              label={`Queue${queue.length > 0 ? ` · ${queue.length}` : ''}`}
              onPress={() => navigation.navigate('Queue')}
            />
            <FooterButton icon="volume-high-outline" label="Output" onPress={openOutputSheet} />
            <FooterButton
              icon="share-outline"
              label="Share"
              onPress={() => {
                void shareEntity({
                  type: 'song',
                  id: track.id,
                  title: track.title,
                  subtitle: track.artists.map((item) => item.name).join(', '),
                });
              }}
            />
          </View>
        </View>
      </View>

      <BottomSheet
        visible={outputSheet}
        onClose={() => setOutputSheet(false)}
        title="Audio output"
        subtitle="Play through a connected speaker"
      >
        <SheetRow
          icon="options-outline"
          label="Automatic"
          detail="Follow Android's default routing"
          tone="accent"
          onPress={() => selectOutput(-1, true)}
        />
        {outputsLoading && outputs.length === 0 ? (
          <Text
            variant="caption"
            style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}
          >
            Looking for devices…
          </Text>
        ) : null}
        {outputs.map((device) => {
          const detail =
            device.productName && device.productName !== device.name
              ? device.productName
              : undefined;
          return (
            <SheetRow
              key={device.id}
              icon={outputIcon(device.name)}
              label={device.name}
              detail={detail}
              tone={device.isCurrent ? 'accent' : 'default'}
              onPress={() => selectOutput(device.id, false)}
            />
          );
        })}
      </BottomSheet>

      <ConfirmDialog
        visible={confirmRemove}
        title="Remove download?"
        message="The downloaded audio will be deleted from this device. You can stream the song or download it again later."
        confirmLabel="Remove"
        destructive
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          if (!download) return;
          setConfirmRemove(false);
          void removeDownload(download.jobId)
            .then(() => toast('Download removed', 'success'))
            .catch(() => toast('Could not remove the download', 'error'));
        }}
      />
    </View>
  );
}

function outputIcon(name: string): ComponentProps<typeof Ionicons>['name'] {
  if (name.includes('Bluetooth')) return 'bluetooth-outline';
  if (name.includes('USB')) return 'hardware-chip-outline';
  if (name.includes('HDMI')) return 'tv-outline';
  if (name.includes('Wired')) return 'headset-outline';
  return 'volume-medium-outline';
}

function FooterButton({
  icon,
  label,
  onPress,
  active,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: 3,
        paddingVertical: 5,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={19} color={active ? colors.accent : colors.textMuted} />
      <Text variant="caption" style={{ color: active ? colors.accent : colors.textMuted }}>
        {label}
      </Text>
    </Pressable>
  );
}
