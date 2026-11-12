import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, radii, spacing } from '../theme';
import { Text } from '../components/Text';
import { Artwork } from '../components/Artwork';
import { BottomSheet, ConfirmDialog, SheetRow, toast } from '../components/Overlays';
import { useSongMenuStore } from './songMenuStore';
import { playerService } from '../../services/player/PlayerService';
import { useLibraryStore, type LocalPlaylist } from '../../services/library/libraryStore';
import { isDownloadInProgress, useDownloadsStore } from '../../services/library/downloadsStore';
import { useDownloadProgressStore } from '../../services/library/downloadProgressStore';
import { useLockStore } from '../../features/lock/lockStore';
import { navigateTo } from '../navigation/navigation';
import { shareEntity } from '../../utils/share';
import { formatDuration } from '../../utils/format';

type Mode = 'main' | 'playlists' | 'details';

/** A new-playlist action should not create a pile of identically named rows. */
function nextPlaylistName(playlists: LocalPlaylist[]): string {
  const base = 'New playlist';
  if (!playlists.some((playlist) => playlist.name === base)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base} ${index}`;
    if (!playlists.some((playlist) => playlist.name === candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

export function SongMenuHost() {
  const track = useSongMenuStore((state) => state.track);
  const context = useSongMenuStore((state) => state.context);
  const close = useSongMenuStore((state) => state.close);
  const favoriteIds = useLibraryStore((state) => state.favoriteIds);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const playlists = useLibraryStore((state) => state.playlists);
  const addPlaylist = useLibraryStore((state) => state.addPlaylist);
  const addToPlaylist = useLibraryStore((state) => state.addToPlaylist);
  const thumbsUp = useLibraryStore((state) => state.thumbsUp);
  const thumbsDown = useLibraryStore((state) => state.thumbsDown);
  const hiddenTrackIds = useLibraryStore((state) => state.hiddenTrackIds);
  const hiddenArtistNames = useLibraryStore((state) => state.hiddenArtistNames);
  const setThumb = useLibraryStore((state) => state.setThumb);
  const hideTrack = useLibraryStore((state) => state.hideTrack);
  const hideArtist = useLibraryStore((state) => state.hideArtist);
  const unhideTrack = useLibraryStore((state) => state.unhideTrack);
  const unhideArtist = useLibraryStore((state) => state.unhideArtist);
  const downloads = useDownloadsStore((state) => state.downloads);
  const downloadTrack = useDownloadsStore((state) => state.downloadTrack);
  const removeDownload = useDownloadsStore((state) => state.removeDownload);
  const retryDownload = useDownloadsStore((state) => state.retryDownload);
  const liveProgress = useDownloadProgressStore((state) => state.progress);
  const locked = useLockStore((state) => state.enabled && !state.unlocked);

  const [mode, setMode] = useState<Mode>('main');
  const [confirmRemoveDownload, setConfirmRemoveDownload] = useState(false);

  useEffect(() => {
    if (track) {
      // A new track should always reopen on the root menu.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode('main');
      setConfirmRemoveDownload(false);
    }
  }, [track]);

  // Native modals float above the lock overlay, so armed lock closes the menu.
  useEffect(() => {
    if (locked) close();
  }, [locked, close]);

  if (!track) return null;

  const download = downloads.find((record) => record.track.id === track.id);
  const favorite = favoriteIds.has(track.id);
  const isDownloaded = download?.phase === 'completed' && Boolean(download.localUri);
  const isDownloading = download ? isDownloadInProgress(download.phase) : false;
  const canDownload = !isDownloaded && !isDownloading;
  const downloadPercent = download
    ? (liveProgress[download.jobId] ?? download.progress)
    : 0;
  const artist = track.artists[0];
  const thumb = thumbsUp[track.id] ? 'up' : thumbsDown[track.id] ? 'down' : undefined;
  const trackHidden = hiddenTrackIds.includes(track.id);
  const artistHidden = Boolean(artist && hiddenArtistNames.includes(artist.name));

  // Downloads resolve only when the whole transfer finishes. Starting one is
  // synchronous, so acknowledge the queue immediately instead of leaving the
  // menu in a fake "loading" state for the length of the download.
  const startDownload = () => {
    if (!canDownload) return;
    const pending = downloadTrack(track);
    toast('Download started', 'success');
    close();
    void pending.catch((error: unknown) => {
      toast(error instanceof Error ? error.message : 'Download could not start', 'error');
    });
  };

  const retry = () => {
    if (!download) return;
    const pending = retryDownload(download.jobId);
    toast('Download retried', 'success');
    close();
    void pending.catch((error: unknown) => {
      toast(error instanceof Error ? error.message : 'Retry failed', 'error');
    });
  };

  return (
    <>
      <BottomSheet
        // A confirmation is its own native modal; presenting it over this
        // sheet is unsupported on iOS and brittle on Android.
        visible={!confirmRemoveDownload}
        onClose={close}
        title={mode === 'main' ? undefined : mode === 'playlists' ? 'Add to playlist' : 'Song details'}
        scroll
      >
        {mode === 'main' ? (
          <>
            <View
              style={{
                flexDirection: 'row',
                gap: spacing.sm,
                alignItems: 'center',
                paddingHorizontal: spacing.lg,
                paddingBottom: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.borderSoft,
                marginBottom: spacing.xs,
              }}
            >
              <Artwork uri={track.artworkUrl} size={54} radius={9} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {track.title}
                </Text>
                <Text variant="small" numberOfLines={1}>
                  {track.artists.map((item) => item.name).join(', ')}
                </Text>
                {context.sourceLabel ? (
                  <Text variant="caption" style={{ color: colors.accent }}>
                    {context.sourceLabel}
                  </Text>
                ) : null}
              </View>
            </View>

            <SheetRow
              icon="play"
              label="Play now"
              onPress={() => {
                void playerService.playTrack(track);
                close();
              }}
            />
            <SheetRow
              icon="play-forward"
              label="Play next"
              onPress={() => {
                void playerService.playNext(track).then((added) => {
                  toast(added ? 'Added to play next' : 'Already in your queue', added ? 'success' : 'default');
                });
                close();
              }}
            />
            <SheetRow
              icon="list"
              label="Add to queue"
              onPress={() => {
                void playerService.addToQueue(track).then((added) => {
                  toast(added ? 'Added to queue' : 'Already in your queue', added ? 'success' : 'default');
                });
                close();
              }}
            />
            <SheetRow
              icon="add-circle-outline"
              label="Add to playlist"
              onPress={() => setMode('playlists')}
            />
            <SheetRow
              icon={favorite ? 'heart' : 'heart-outline'}
              label={favorite ? 'Remove from Liked Songs' : 'Like song'}
              tone={favorite ? 'accent' : 'default'}
              onPress={() => {
                toggleFavorite(track);
                toast(favorite ? 'Removed from Liked Songs' : 'Added to Liked Songs', 'success');
                close();
              }}
            />
            <SheetRow
              icon={thumb === 'up' ? 'thumbs-up' : 'thumbs-up-outline'}
              label="More like this"
              tone={thumb === 'up' ? 'accent' : 'default'}
              onPress={() => {
                setThumb(track.id, thumb === 'up' ? 'none' : 'up');
                toast(
                  thumb === 'up' ? 'Recommendation feedback removed' : 'Sinc will recommend more like this',
                  'success'
                );
                close();
              }}
            />
            <SheetRow
              icon={thumb === 'down' ? 'thumbs-down' : 'thumbs-down-outline'}
              label="Less like this"
              tone={thumb === 'down' ? 'accent' : 'default'}
              onPress={() => {
                setThumb(track.id, thumb === 'down' ? 'none' : 'down');
                toast(
                  thumb === 'down' ? 'Recommendation feedback removed' : 'Sinc will recommend less like this',
                  'success'
                );
                close();
              }}
            />
            {trackHidden ? (
              <SheetRow
                icon="eye-outline"
                label="Show this song in recommendations"
                onPress={() => {
                  unhideTrack(track.id);
                  toast('Song will be recommended again', 'success');
                  close();
                }}
              />
            ) : (
              <SheetRow
                icon="eye-off-outline"
                label="Don’t recommend this song"
                onPress={() => {
                  hideTrack(track.id);
                  toast('Sinc will avoid recommending this song', 'success');
                  close();
                }}
              />
            )}
            {artist ? (
              artistHidden ? (
                <SheetRow
                  icon="person-add-outline"
                  label={`Show ${artist.name} in recommendations`}
                  onPress={() => {
                    unhideArtist(artist.name);
                    toast(`${artist.name} will be recommended again`, 'success');
                    close();
                  }}
                />
              ) : (
                <SheetRow
                  icon="person-remove-outline"
                  label={`Don’t recommend ${artist.name}`}
                  onPress={() => {
                    hideArtist(artist.name);
                    toast(`Sinc will avoid recommending ${artist.name}`, 'success');
                    close();
                  }}
                />
              )
            ) : null}
            {track.album?.id ? (
              <SheetRow
                icon="disc-outline"
                label="Go to album"
                detail={track.album.title}
                onPress={() => {
                  close();
                  navigateTo('Album', { id: track.album?.id ?? '', title: track.album?.title });
                }}
              />
            ) : null}
            {artist ? (
              <SheetRow
                icon="person-outline"
                label="Go to artist"
                detail={artist.name}
                onPress={() => {
                  close();
                  navigateTo('Artist', { id: artist.id, name: artist.name });
                }}
              />
            ) : null}
            {isDownloaded ? (
              <SheetRow
                icon="trash-outline"
                label="Remove download"
                tone="danger"
                detail="The song stays in your library."
                onPress={() => setConfirmRemoveDownload(true)}
              />
            ) : isDownloading ? (
              <SheetRow
                icon="cloud-download-outline"
                label="Download in progress"
                detail={`${Math.round(downloadPercent)}% complete`}
                onPress={() => {
                  close();
                  navigateTo('Downloads');
                }}
              />
            ) : download?.phase === 'failed' ? (
              <SheetRow
                icon="refresh"
                label="Retry download"
                detail={download.error}
                onPress={retry}
              />
            ) : canDownload ? (
              <SheetRow
                icon="download-outline"
                label="Download"
                onPress={startDownload}
              />
            ) : null}
            <SheetRow
              icon="information-circle-outline"
              label="Song details"
              onPress={() => setMode('details')}
            />
            <SheetRow
              icon="share-outline"
              label="Share"
              onPress={() => {
                void shareEntity({
                  type: 'song',
                  id: track.id,
                  title: track.title,
                  subtitle: track.artists.map((item) => item.name).join(', '),
                });
                close();
              }}
            />
            {context.onRemoveFromPlaylist ? (
              <SheetRow
                icon="remove-circle-outline"
                label="Remove from this playlist"
                tone="danger"
                onPress={() => {
                  context.onRemoveFromPlaylist?.();
                  close();
                }}
              />
            ) : null}
            {context.onRemoveFromHistory ? (
              <SheetRow
                icon="time-outline"
                label="Remove from recently played"
                onPress={() => {
                  context.onRemoveFromHistory?.();
                  close();
                }}
              />
            ) : null}
            {context.onRemoveFromQueue ? (
              <SheetRow
                icon="remove-circle-outline"
                label="Remove from queue"
                tone="danger"
                onPress={() => {
                  context.onRemoveFromQueue?.();
                  close();
                }}
              />
            ) : null}
            {context.onMoveUp ? (
              <SheetRow
                icon="arrow-up"
                label="Move up"
                onPress={() => {
                  context.onMoveUp?.();
                  close();
                }}
              />
            ) : null}
            {context.onMoveDown ? (
              <SheetRow
                icon="arrow-down"
                label="Move down"
                onPress={() => {
                  context.onMoveDown?.();
                  close();
                }}
              />
            ) : null}
          </>
        ) : null}

        {mode === 'playlists' ? (
          <>
            <SheetRow
              icon="add"
              label="New playlist"
              tone="accent"
              onPress={() => {
                const playlistId = addPlaylist(nextPlaylistName(playlists), [track]);
                toast('Playlist created with this song', 'success');
                close();
                navigateTo('LocalPlaylist', { id: playlistId });
              }}
            />
            {playlists.map((playlist) => {
              const exists = playlist.tracks.some((item) => item.id === track.id);
              return (
                <SheetRow
                  key={playlist.id}
                  icon={exists ? 'checkmark-circle' : 'musical-notes-outline'}
                  label={playlist.name}
                  detail={`${playlist.tracks.length} songs${exists ? ' · already added' : ''}`}
                  disabled={exists}
                  onPress={() => {
                    addToPlaylist(playlist.id, track);
                    toast(`Added to ${playlist.name}`, 'success');
                    close();
                  }}
                />
              );
            })}
            <Pressable
              onPress={() => setMode('main')}
              accessibilityRole="button"
              style={{ padding: spacing.lg }}
            >
              <Text variant="small" style={{ color: colors.accent, fontWeight: '700' }}>
                Back
              </Text>
            </Pressable>
          </>
        ) : null}

        {mode === 'details' ? (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            <Artwork uri={track.artworkUrl} size={220} radius={radii.lg} style={{ alignSelf: 'center' }} />
            <View style={{ gap: 10 }}>
              <DetailLine label="Title" value={track.title} />
              <DetailLine label="Artist" value={track.artists.map((item) => item.name).join(', ')} />
              {track.album ? <DetailLine label="Album" value={track.album.title} /> : null}
              <DetailLine
                label="Duration"
                value={track.durationMs > 0 ? formatDuration(track.durationMs) : 'Unknown'}
              />
              <DetailLine
                label="Source"
                value={
                  track.providerIds.deezer
                    ? 'Deezer'
                    : track.providerIds.itunes
                      ? 'iTunes'
                      : 'Sinc'
                }
              />
              <DetailLine
                label="Offline"
                value={isDownloaded ? 'Downloaded' : isDownloading ? 'Downloading' : 'Not downloaded'}
              />
              {track.isrc ? <DetailLine label="ISRC" value={track.isrc} /> : null}
            </View>
            <Pressable
              onPress={() => setMode('main')}
              accessibilityRole="button"
              style={{ paddingVertical: spacing.md }}
            >
              <Text variant="small" style={{ color: colors.accent, fontWeight: '700' }}>
                Back
              </Text>
            </Pressable>
          </View>
        ) : null}
      </BottomSheet>

      <ConfirmDialog
        visible={confirmRemoveDownload}
        title="Remove download?"
        message="The audio file will be deleted from this device. The song remains in your library and can be streamed or downloaded again."
        confirmLabel="Remove"
        destructive
        onCancel={() => setConfirmRemoveDownload(false)}
        onConfirm={() => {
          setConfirmRemoveDownload(false);
          if (!download) return;
          void removeDownload(download.jobId)
            .then(() => {
              toast('Download removed', 'success');
              close();
            })
            .catch(() => toast('Could not remove the download', 'error'));
        }}
      />
    </>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      <Text variant="small" style={{ width: 78, color: colors.textMuted }}>
        {label}
      </Text>
      <Text variant="small" style={{ flex: 1, color: colors.textSecondary }}>
        {value}
      </Text>
    </View>
  );
}

export function SongMenuIcon({ onPress, label = 'More options' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
    >
      <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
    </Pressable>
  );
}
