import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CollectionScaffold } from '../components/CollectionScaffold';
import { Text } from '../components/Text';
import { IconButton } from '../components/Buttons';
import { BottomSheet, ConfirmDialog, SheetRow, toast } from '../components/Overlays';
import { EmptyState } from '../components/State';
import { colors, radii, spacing } from '../theme';
import { musicApi, type DailyMix } from '../../api/music';
import { getCachedPersonalizedHome } from '../../api/resultCache';
import { useAuthStore } from '../../features/auth/authStore';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { queueTracksForDownload } from '../../services/library/downloadQueue';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { playerService } from '../../services/player/PlayerService';
import { openSongMenu } from '../songMenu/songMenuStore';
import { shareEntity } from '../../utils/share';
import { playlistArtworkUrl } from '../../components/PlaylistCover';
import { shuffled } from '../../services/local/affinity';
import type { RootStackParamList } from '../../app/navigation/types';

const EMPTY_LIBRARY = {
  playlists: [],
  recentlyPlayedPlaylistIds: [],
  downloadedTracks: [],
  followedArtists: [],
  followedAlbums: [],
};

function useDownloadedIds(): Set<string> {
  const downloads = useDownloadsStore((state) => state.downloads);
  return useMemo(
    () =>
      new Set(
        downloads
          .filter((record) => record.phase === 'completed' && record.localUri)
          .map((record) => record.track.id)
      ),
    [downloads]
  );
}

function QuickAction({
  icon,
  label,
  onPress,
  active,
  disabled,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <IconButton
      icon={icon}
      label={label}
      size={50}
      background={active ? colors.accentSoft : colors.card}
      color={active ? colors.accent : colors.text}
      disabled={disabled}
      onPress={onPress}
    />
  );
}

export function AlbumScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Album'>) {
  const { id } = route.params;
  const query = useQuery({
    queryKey: ['album', id],
    queryFn: () => musicApi.getAlbum(id),
    enabled: Boolean(id),
    retry: 1,
  });
  const followedAlbums = useLibraryStore((state) => state.followedAlbums);
  const toggleFollowAlbum = useLibraryStore((state) => state.toggleFollowAlbum);
  const downloadedIds = useDownloadedIds();
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const playing = usePlayerStore((state) => state.status === 'playing');
  const [downloadBusy, setDownloadBusy] = useState(false);

  const album = query.data?.album;
  const tracks = query.data?.tracks ?? [];
  const saved = album ? followedAlbums.some((item) => item.id === album.id) : false;
  const alreadyDownloaded =
    tracks.length > 0 && tracks.every((track) => downloadedIds.has(track.id));

  const play = (index: number, shuffle = false) => {
    if (tracks.length === 0) return;
    const queue = shuffle ? shuffled(tracks, Math.random) : tracks;
    void playerService.playQueue(queue, shuffle ? 0 : index);
    navigation.navigate('Player');
  };

  const downloadAll = async () => {
    setDownloadBusy(true);
    const result = await queueTracksForDownload(tracks);
    setDownloadBusy(false);
    toast(
      result.queued > 0
        ? `Downloading ${result.queued} song${result.queued === 1 ? '' : 's'}`
        : 'All songs are already downloaded or downloading',
      result.queued > 0 ? 'success' : 'default'
    );
  };

  return (
    <CollectionScaffold
      label="Album"
      title={album?.title ?? route.params.title ?? 'Album'}
      subtitle={album?.artist.name}
      artworkUri={album?.artworkUrl}
      meta={
        album
          ? `${tracks.length} songs${album.releaseDate ? ` · ${album.releaseDate.slice(0, 4)}` : ''}`
          : undefined
      }
      tracks={tracks}
      loading={query.isLoading}
      error={query.isError}
      errorMessage={query.error instanceof Error ? query.error.message : undefined}
      onBack={() => navigation.goBack()}
      onRetry={() => void query.refetch()}
      onPlayAll={() => play(0)}
      onShuffleAll={() => play(0, true)}
      onPlayTrack={(_track, index) => play(index)}
      onMoreTrack={(track) =>
        openSongMenu(track, { sourceLabel: album ? `Album · ${album.title}` : 'Album' })
      }
      downloadedIds={downloadedIds}
      currentTrackId={currentTrack?.id}
      isPlaying={playing}
      headerRight={
        album ? (
          <IconButton
            icon="share-outline"
            label="Share album"
            size={38}
            background="rgba(255,255,255,0.08)"
            onPress={() =>
              void shareEntity({
                type: 'album',
                id: album.id,
                title: album.title,
                subtitle: album.artist.name,
              })
            }
          />
        ) : null
      }
      quickActions={
        album ? (
          <>
            <QuickAction
              icon={saved ? 'bookmark' : 'bookmark-outline'}
              label={saved ? 'Remove saved album' : 'Save album'}
              active={saved}
              onPress={() => {
                toggleFollowAlbum(album);
                toast(saved ? 'Removed album from your library' : 'Album saved', 'success');
              }}
            />
            <QuickAction
              icon={alreadyDownloaded ? 'checkmark-circle' : 'download-outline'}
              label={alreadyDownloaded ? 'Album downloaded' : 'Download album'}
              active={alreadyDownloaded}
              disabled={downloadBusy || tracks.length === 0}
              onPress={() => void downloadAll()}
            />
          </>
        ) : null
      }
      emptyTitle="This album has no tracks"
      emptyMessage="The provider returned an empty track list."
    />
  );
}

import { openSpotifyUrl } from '../../services/providers/spotifyUrl';
import { Linking } from 'react-native';
export { ArtistHubScreen as ArtistScreen } from './ArtistHubScreen';

export function PlaylistScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Playlist'>) {
  const { id } = route.params;
  const query = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => musicApi.getPlaylist(id),
    enabled: Boolean(id),
    retry: 1,
  });
  const addPlaylist = useLibraryStore((state) => state.addPlaylist);
  const playlists = useLibraryStore((state) => state.playlists);
  const downloadedIds = useDownloadedIds();
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const playing = usePlayerStore((state) => state.status === 'playing');
  const [saved, setSaved] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);

  const playlist = query.data?.playlist;
  const tracks = query.data?.tracks ?? [];
  const alreadyCopied = playlist
    ? playlists.some(
        (item) =>
          item.name === playlist.name &&
          item.tracks.length === tracks.length &&
          item.tracks[0]?.id === tracks[0]?.id
      )
    : false;

  const play = (index: number, shuffle = false) => {
    if (tracks.length === 0) return;
    const queue = shuffle ? shuffled(tracks, Math.random) : tracks;
    void playerService.playQueue(queue, shuffle ? 0 : index);
    navigation.navigate('Player');
  };

  const saveCopy = () => {
    if (!playlist || saved) return;
    const newId = addPlaylist(playlist.name, tracks, playlist.description);
    setSaved(true);
    toast('Playlist saved to your library', 'success');
    navigation.navigate('LocalPlaylist', { id: newId });
  };

  const downloadAll = async () => {
    setDownloadBusy(true);
    const result = await queueTracksForDownload(tracks);
    setDownloadBusy(false);
    toast(
      result.queued > 0
        ? `Downloading ${result.queued} song${result.queued === 1 ? '' : 's'}`
        : 'All songs are already downloaded or downloading',
      result.queued > 0 ? 'success' : 'default'
    );
  };

  return (
    <CollectionScaffold
      label="Playlist"
      title={playlist?.name ?? route.params.name ?? 'Playlist'}
      subtitle={playlist?.owner.name}
      description={playlist?.description}
      artworkUri={playlist?.artworkUrl}
      meta={`${tracks.length} songs · ${
        playlist?.providerIds.deezer ? 'Deezer' : playlist?.providerIds.itunes ? 'iTunes' : 'Sinc'
      }`}
      tracks={tracks}
      loading={query.isLoading}
      error={query.isError}
      errorMessage={query.error instanceof Error ? query.error.message : undefined}
      onBack={() => navigation.goBack()}
      onRetry={() => void query.refetch()}
      onPlayAll={() => play(0)}
      onShuffleAll={() => play(0, true)}
      onPlayTrack={(_track, index) => play(index)}
      onMoreTrack={(track) =>
        openSongMenu(track, { sourceLabel: playlist ? `Playlist · ${playlist.name}` : 'Playlist' })
      }
      downloadedIds={downloadedIds}
      currentTrackId={currentTrack?.id}
      isPlaying={playing}
      headerRight={
        playlist ? (
          <IconButton
            icon="share-outline"
            label="Share playlist"
            size={38}
            background="rgba(255,255,255,0.08)"
            onPress={() =>
              void shareEntity({
                type: 'playlist',
                id: playlist.id,
                title: playlist.name,
                subtitle: playlist.owner.name,
              })
            }
          />
        ) : null
      }
      quickActions={
        playlist ? (
          <>
            <QuickAction
              icon={saved || alreadyCopied ? 'checkmark' : 'add'}
              label={saved || alreadyCopied ? 'Saved to library' : 'Save playlist to library'}
              active={saved || alreadyCopied}
              disabled={saved || alreadyCopied}
              onPress={saveCopy}
            />
            <QuickAction
              icon="download-outline"
              label="Download playlist"
              disabled={downloadBusy || tracks.length === 0}
              onPress={() => void downloadAll()}
            />
            {playlist.providerIds?.deezer ? (
              <QuickAction
                icon="open-outline"
                label="Open in Deezer"
                onPress={() =>
                  void Linking.openURL(`https://www.deezer.com/playlist/${playlist.providerIds.deezer}`)
                }
              />
            ) : playlist.providerIds?.spotify ? (
              <QuickAction
                icon="open-outline"
                label="Open in Spotify"
                onPress={() =>
                  void openSpotifyUrl(
                    `https://open.spotify.com/playlist/${playlist.providerIds.spotify}`
                  )
                }
              />
            ) : null}
          </>
        ) : null
      }
      emptyTitle="This playlist is empty"
      emptyMessage="The provider did not return any playable tracks."
    />
  );
}

function findMix(
  feed: { sections: Array<{ kind: string; mixes?: DailyMix[] }> } | null,
  mixId: string
): DailyMix | null {
  for (const section of feed?.sections ?? []) {
    if (section.kind === 'mixes') {
      const found = section.mixes?.find((mix) => mix.id === mixId);
      if (found) return found;
    }
  }
  return null;
}

export function MixScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Mix'>) {
  const { mix: routeMix, mixId } = route.params;
  const userId = useAuthStore((state) => state.user.id);
  const addPlaylist = useLibraryStore((state) => state.addPlaylist);
  const downloadedIds = useDownloadedIds();
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const playing = usePlayerStore((state) => state.status === 'playing');
  const [remoteMix, setRemoteMix] = useState<DailyMix | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [loadError, setLoadError] = useState(!routeMix && !mixId);
  const [saved, setSaved] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);

  const cachedMix = useMemo(() => {
    if (routeMix) return routeMix;
    if (!mixId) return null;
    return findMix(getCachedPersonalizedHome(userId)?.data ?? null, mixId);
  }, [routeMix, mixId, userId]);
  const mix = cachedMix ?? remoteMix;
  const loading = !mix && !loadError;

  useEffect(() => {
    if (cachedMix || !mixId || loadError) return;
    let active = true;
    void musicApi
      .getPersonalizedHomeFeed(EMPTY_LIBRARY)
      .then((feed) => {
        if (!active) return;
        const found = findMix(feed, mixId);
        if (found) setRemoteMix(found);
        else setLoadError(true);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [cachedMix, mixId, retryKey, loadError]);

  const play = (index: number, shuffle = false) => {
    if (!mix || mix.tracks.length === 0) return;
    const queue = shuffle ? shuffled(mix.tracks, Math.random) : mix.tracks;
    void playerService.playQueue(queue, shuffle ? 0 : index);
    navigation.navigate('Player');
  };

  const saveMix = () => {
    if (!mix || saved) return;
    const newId = addPlaylist(
      mix.name,
      mix.tracks,
      mix.description ?? `A ${mix.kind} mix from Sinc.`
    );
    setSaved(true);
    toast('Mix saved as a playlist', 'success');
    navigation.navigate('LocalPlaylist', { id: newId });
  };

  const downloadAll = async () => {
    if (!mix) return;
    setDownloadBusy(true);
    const result = await queueTracksForDownload(mix.tracks);
    setDownloadBusy(false);
    toast(
      result.queued > 0
        ? `Downloading ${result.queued} song${result.queued === 1 ? '' : 's'}`
        : 'All songs are already downloaded or downloading',
      result.queued > 0 ? 'success' : 'default'
    );
  };

  return (
    <CollectionScaffold
      label="Made for you"
      title={mix?.name ?? 'Mix'}
      subtitle={mix ? `${mix.genre} · ${mix.kind}` : undefined}
      description={mix?.description}
      artworkUri={mix?.artworkUrl}
      meta={mix ? `${mix.tracks.length} songs` : undefined}
      tracks={mix?.tracks ?? []}
      loading={loading}
      error={loadError}
      errorMessage="This mix is no longer available. Mixes change as your listening changes."
      onBack={() => navigation.goBack()}
      onRetry={() => {
        setLoadError(false);
        setRemoteMix(null);
        setRetryKey((key) => key + 1);
      }}
      onPlayAll={() => play(0)}
      onShuffleAll={() => play(0, true)}
      onPlayTrack={(_track, index) => play(index)}
      onMoreTrack={(track) =>
        openSongMenu(track, { sourceLabel: mix ? `Mix · ${mix.name}` : 'Mix' })
      }
      downloadedIds={downloadedIds}
      currentTrackId={currentTrack?.id}
      isPlaying={playing}
      headerRight={
        mix ? (
          <IconButton
            icon="share-outline"
            label="Share mix"
            size={38}
            background="rgba(255,255,255,0.08)"
            onPress={() =>
              void shareEntity({
                type: 'mix',
                id: mix.id,
                title: mix.name,
                subtitle: mix.genre,
              })
            }
          />
        ) : null
      }
      quickActions={
        mix ? (
          <>
            <QuickAction
              icon={saved ? 'checkmark' : 'add'}
              label={saved ? 'Mix saved' : 'Save mix as playlist'}
              active={saved}
              disabled={saved}
              onPress={saveMix}
            />
            <QuickAction
              icon="download-outline"
              label="Download mix"
              disabled={downloadBusy || mix.tracks.length === 0}
              onPress={() => void downloadAll()}
            />
          </>
        ) : null
      }
      emptyTitle="This mix is empty"
      emptyMessage="Play more music and Sinc will rebuild it."
    />
  );
}

export function LocalPlaylistScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'LocalPlaylist'>) {
  const playlist = useLibraryStore((state) =>
    state.playlists.find((item) => item.id === route.params.id)
  );
  const removeFromPlaylist = useLibraryStore((state) => state.removeFromPlaylist);
  const reorderPlaylistTracks = useLibraryStore((state) => state.reorderPlaylistTracks);
  const duplicatePlaylist = useLibraryStore((state) => state.duplicatePlaylist);
  const deletePlaylist = useLibraryStore((state) => state.deletePlaylist);
  const recordPlaylistPlayed = useLibraryStore((state) => state.recordPlaylistPlayed);
  const downloadedIds = useDownloadedIds();
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const playing = usePlayerStore((state) => state.status === 'playing');
  const [reorderMode, setReorderMode] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [selectionActive, setSelectionActive] = useState(false);

  const tracks = playlist?.tracks ?? [];
  const cover = playlist?.coverArtworkUrl ?? playlistArtworkUrl(tracks);
  const downloadedCount = tracks.filter((track) => downloadedIds.has(track.id)).length;

  const play = (index: number, shuffle = false) => {
    if (!playlist || tracks.length === 0) return;
    recordPlaylistPlayed(playlist.id);
    const queue = shuffle ? shuffled(tracks, Math.random) : tracks;
    void playerService.playQueue(queue, shuffle ? 0 : index);
    navigation.navigate('Player');
  };

  const downloadAll = async () => {
    if (!playlist) return;
    setDownloadBusy(true);
    const result = await queueTracksForDownload(tracks);
    setDownloadBusy(false);
    toast(
      result.queued > 0
        ? `Downloading ${result.queued} song${result.queued === 1 ? '' : 's'}`
        : 'All songs are already downloaded or downloading',
      result.queued > 0 ? 'success' : 'default'
    );
  };

  if (!playlist) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg }}>
        <View style={{ flexDirection: 'row', paddingTop: spacing.xxl }}>
          <IconButton
            icon="chevron-back"
            label="Back"
            size={38}
            background={colors.card}
            onPress={() => navigation.goBack()}
          />
        </View>
        <EmptyState
          icon="list-outline"
          title="Playlist not found"
          message="It may have been deleted on this device."
          actionLabel="Back to library"
          onAction={() =>
            navigation.navigate('Main', {
              screen: 'Library',
              params: { category: 'Playlists' },
            })
          }
        />
      </View>
    );
  }

  return (
    <>
      <CollectionScaffold
        label="Playlist"
        title={playlist.name}
        subtitle={`Created by you · ${playlist.tracks.length} songs`}
        description={playlist.description}
        artworkUri={cover}
        meta={`${downloadedCount} of ${playlist.tracks.length} downloaded`}
        tracks={tracks}
        onBack={() => navigation.goBack()}
        onPlayAll={() => play(0)}
        onShuffleAll={() => play(0, true)}
        onPlayTrack={(_track, index) => play(index)}
        onMoreTrack={
          reorderMode
            ? undefined
            : (track) =>
                openSongMenu(track, {
                  sourceLabel: `Playlist · ${playlist.name}`,
                  onRemoveFromPlaylist: () => {
                    removeFromPlaylist(playlist.id, track.id);
                    toast('Removed from playlist', 'success');
                  },
                })
        }
        downloadedIds={downloadedIds}
        currentTrackId={currentTrack?.id}
        isPlaying={playing}
        selectionEnabled={!reorderMode}
        onSelectionActiveChange={setSelectionActive}
        onSelectionRemove={(selected) => {
          for (const track of selected) removeFromPlaylist(playlist.id, track.id);
        }}
        selectionRemoveLabel="Remove"
        headerRight={
          <IconButton
            icon="ellipsis-horizontal"
            label="Playlist options"
            size={38}
            background="rgba(255,255,255,0.08)"
            onPress={() => setActionsOpen(true)}
          />
        }
        beforeTracks={
          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <SmallAction
                icon="create-outline"
                label="Edit"
                onPress={() =>
                  navigation.navigate('PlaylistEditor', {
                    playlistId: playlist.id,
                    mode: 'edit',
                  })
                }
              />
              <SmallAction
                icon="add"
                label="Add songs"
                onPress={() => navigation.navigate('AddSongs', { playlistId: playlist.id })}
              />
              <SmallAction
                icon="download-outline"
                label={downloadBusy ? 'Starting…' : 'Download'}
                disabled={downloadBusy || tracks.length === 0}
                onPress={() => void downloadAll()}
              />
              <SmallAction
                icon="swap-vertical"
                label={reorderMode ? 'Done' : 'Reorder'}
                active={reorderMode}
                disabled={selectionActive}
                onPress={() => setReorderMode((value) => !value)}
              />
            </View>
            {reorderMode ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.xs,
                  backgroundColor: colors.accentSoft,
                  borderRadius: radii.sm,
                  padding: spacing.sm,
                }}
              >
                <Ionicons name="swap-vertical" size={16} color={colors.accent} />
                <Text variant="caption" style={{ color: colors.accentBright, flex: 1 }}>
                  Use the arrows to move songs. Changes save immediately.
                </Text>
              </View>
            ) : null}
          </View>
        }
        renderTrailing={
          reorderMode
            ? (_track, index) => (
                <View style={{ flexDirection: 'row', gap: 2 }}>
                  <IconButton
                    icon="chevron-up"
                    label={`Move ${_track.title} up`}
                    size={30}
                    background={colors.card}
                    disabled={index === 0}
                    onPress={() => reorderPlaylistTracks(playlist.id, index, index - 1)}
                  />
                  <IconButton
                    icon="chevron-down"
                    label={`Move ${_track.title} down`}
                    size={30}
                    background={colors.card}
                    disabled={index === tracks.length - 1}
                    onPress={() => reorderPlaylistTracks(playlist.id, index, index + 1)}
                  />
                </View>
              )
            : undefined
        }
        emptyTitle="This playlist is empty"
        emptyMessage="Add songs from Search, your library, or any album and playlist."
        emptyActionLabel="Add songs"
        onEmptyAction={() => navigation.navigate('AddSongs', { playlistId: playlist.id })}
      />

      <BottomSheet
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title={playlist.name}
        subtitle={`${playlist.tracks.length} songs`}
      >
        <SheetRow
          icon="create-outline"
          label="Edit details"
          onPress={() => {
            setActionsOpen(false);
            navigation.navigate('PlaylistEditor', { playlistId: playlist.id, mode: 'edit' });
          }}
        />
        <SheetRow
          icon="add"
          label="Add songs"
          onPress={() => {
            setActionsOpen(false);
            navigation.navigate('AddSongs', { playlistId: playlist.id });
          }}
        />
        <SheetRow
          icon="download-outline"
          label="Download all"
          onPress={() => {
            setActionsOpen(false);
            void downloadAll();
          }}
        />
        <SheetRow
          icon="copy-outline"
          label="Duplicate playlist"
          onPress={() => {
            setActionsOpen(false);
            const nextId = duplicatePlaylist(playlist.id);
            if (nextId) {
              toast('Playlist duplicated', 'success');
              navigation.navigate('LocalPlaylist', { id: nextId });
            } else {
              toast('Could not duplicate playlist', 'error');
            }
          }}
        />
        <SheetRow
          icon="trash-outline"
          label="Delete playlist"
          tone="danger"
          onPress={() => {
            setActionsOpen(false);
            setDeleteOpen(true);
          }}
        />
      </BottomSheet>

      <ConfirmDialog
        visible={deleteOpen}
        title="Delete playlist?"
        message={`“${playlist.name}” will be removed. Downloaded audio files stay on this device.`}
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false);
          deletePlaylist(playlist.id);
          toast('Playlist deleted', 'success');
          navigation.navigate('Main', {
            screen: 'Library',
            params: { category: 'Playlists' },
          });
        }}
      />
    </>
  );
}

function SmallAction({
  icon,
  label,
  onPress,
  active,
  disabled,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(active), disabled: Boolean(disabled) }}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        minHeight: 36,
        borderRadius: radii.full,
        backgroundColor: active ? colors.accentSoft : colors.card,
        opacity: disabled ? 0.4 : pressed ? 0.68 : 1,
      })}
    >
      <Ionicons name={icon} size={15} color={active ? colors.accent : colors.textSecondary} />
      <Text
        variant="caption"
        numberOfLines={1}
        style={{ color: active ? colors.accent : colors.textSecondary, fontWeight: '700' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
