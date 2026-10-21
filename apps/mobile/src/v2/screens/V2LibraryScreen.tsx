import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Alert, FlatList, I18nManager, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CanonicalTrack } from '@sinc/shared';
import { shuffled as shuffledList } from '../../services/local/affinity';
import { v2Colors, v2Radii, v2Spacing } from '../theme';
import { V2Text } from '../components/V2Text';
import { V2Button } from '../components/V2Button';
import { V2TextField } from '../components/V2Fields';
import { V2TrackRow } from '../components/V2TrackRow';
import { V2Artwork } from '../components/V2Artwork';
import { V2Header } from '../components/V2Header';
import { V2MenuRow } from '../components/V2MenuRow';
import { V2Empty } from '../components/V2State';
import { V2SpotifyImportScreen } from './V2SpotifyImportScreen';
import { SecuritySettings } from '../../features/lock/SecuritySettings';
import { AboutUpdatesView } from '../../features/updates/AboutUpdatesView';
import { useUpdateStore } from '../../features/updates/updateStore';
import { playerService } from '../../services/player/PlayerService';
import { useLibraryStore, type LocalPlaylist } from '../../services/library/libraryStore';
import { playlistArtworkUrl } from '../../components/PlaylistCover';
import { useDownloadsStore, type DownloadRecord } from '../../services/library/downloadsStore';
import { useDownloadProgressStore } from '../../services/library/downloadProgressStore';
import type { MainTabParamList, RootStackParamList } from '../../app/navigation/types';
import { config } from '../../app/config';

type LibraryNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Library'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type LibraryView =
  | { kind: 'root' }
  | { kind: 'favorites' }
  | { kind: 'recent' }
  | { kind: 'playlists' }
  | { kind: 'spotify-import' }
  | { kind: 'playlist'; playlist: LocalPlaylist }
  | { kind: 'downloads' }
  | { kind: 'queue' }
  | { kind: 'settings' }
  | { kind: 'about' };

const TRACK_ROW_HEIGHT = 68;

function V2TrackList({
  title,
  subtitle,
  tracks,
  onBack,
  emptyIcon,
  emptyText,
}: {
  title: string;
  subtitle?: string;
  tracks: CanonicalTrack[];
  onBack: () => void;
  emptyIcon: string;
  emptyText: string;
}) {
  const navigation = useNavigation<LibraryNavigation>();

  const playAt = useCallback(
    (index: number, shuffled: boolean) => {
      if (tracks.length === 0) return;
      // Fisher–Yates (see affinity.ts): sort-by-random is a biased shuffle
      // that could leave near-identity orders on repeated taps.
      const queue = shuffled ? shuffledList(tracks, Math.random) : tracks;
      void playerService.playQueue(queue, shuffled ? 0 : index);
      navigation.navigate('Player');
    },
    [tracks, navigation]
  );

  return (
    <FlatList
      style={{ flex: 1 }}
      data={tracks}
      keyExtractor={(item) => item.id}
      getItemLayout={(_, index) => ({
        length: TRACK_ROW_HEIGHT,
        offset: TRACK_ROW_HEIGHT * index,
        index,
      })}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      contentContainerStyle={{ paddingBottom: v2Spacing.xxxl }}
      ListHeaderComponent={
        <View style={{ gap: v2Spacing.md }}>
          <V2Header title={title} subtitle={subtitle} onBack={onBack} />
          {tracks.length > 0 ? (
            <View style={{ flexDirection: 'row', gap: v2Spacing.sm }}>
              <View style={{ flex: 1 }}>
                <V2Button label="Play" onPress={() => playAt(0, false)} />
              </View>
              <View style={{ flex: 1 }}>
                <V2Button label="Shuffle" variant="secondary" onPress={() => playAt(0, true)} />
              </View>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={<V2Empty icon={emptyIcon} title={title} hint={emptyText} />}
      renderItem={({ item, index }) => (
        <V2TrackRow
          track={item}
          showFavorite
          showAdd
          showDownload
          onPress={() => playAt(index, false)}
        />
      )}
    />
  );
}

function V2PlaylistDetail({ playlist, onBack }: { playlist: LocalPlaylist; onBack: () => void }) {
  const navigation = useNavigation<LibraryNavigation>();
  const tracks = playlist.tracks;
  const downloadTrack = useDownloadsStore((s) => s.downloadTrack);
  const isDownloaded = useDownloadsStore((s) => s.isDownloaded);
  const getDownload = useDownloadsStore((s) => s.getDownload);
  const removeFromPlaylist = useLibraryStore((s) => s.removeFromPlaylist);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [allDone, setAllDone] = useState(0);
  const [allTotal, setAllTotal] = useState(0);
  const [allFailed, setAllFailed] = useState(0);

  // Leaving the screen must not keep setting state (React warning + leaks);
  // the loop below only touches setState while this component is mounted.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const pendingCount = tracks.filter((t) => !isDownloaded(t.id)).length;

  const playAt = useCallback(
    (index: number) => {
      useLibraryStore.getState().recordPlaylistPlayed(playlist.id);
      void playerService.playQueue(tracks, index);
      navigation.navigate('Player');
    },
    [tracks, playlist.id, navigation]
  );

  const downloadAll = useCallback(async () => {
    const pending = tracks.filter((t) => !isDownloaded(t.id));
    if (pending.length === 0 || downloadingAll) return;
    setDownloadingAll(true);
    setAllTotal(pending.length);
    setAllDone(0);
    setAllFailed(0);
    let done = 0;
    let failed = 0;
    for (const track of pending) {
      await downloadTrack(track);
      const phase = getDownload(track.id)?.phase;
      // Mid-batch a later change can resolve the row (downloaded/paused);
      // only a definitively failed job counts as a failure.
      if (phase === 'failed') failed += 1;
      done += 1;
      if (aliveRef.current) {
        setAllDone(done);
        setAllFailed(failed);
      }
    }
    if (aliveRef.current) setDownloadingAll(false);
  }, [tracks, isDownloaded, getDownload, downloadTrack, downloadingAll]);

  return (
    <FlatList
      style={{ flex: 1 }}
      data={tracks}
      keyExtractor={(item) => item.id}
      getItemLayout={(_, index) => ({
        length: TRACK_ROW_HEIGHT,
        offset: TRACK_ROW_HEIGHT * index,
        index,
      })}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      contentContainerStyle={{ paddingBottom: v2Spacing.xxxl }}
      ListHeaderComponent={
        <View style={{ gap: v2Spacing.md }}>
          <V2Header
            title={playlist.name}
            subtitle={`${tracks.length} songs`}
            onBack={onBack}
            right={
              <Pressable
                hitSlop={10}
                accessibilityLabel="Delete playlist"
                onPress={() =>
                  Alert.alert(
                    'Delete playlist',
                    `Delete "${playlist.name}"? Its songs stay in your library.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => {
                          useLibraryStore.getState().deletePlaylist(playlist.id);
                          onBack();
                        },
                      },
                    ]
                  )
                }
              >
                <Ionicons name="trash-outline" size={20} color={v2Colors.textMuted} />
              </Pressable>
            }
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: v2Spacing.md }}>
            <V2Artwork uri={playlistArtworkUrl(tracks)} size={104} />
            <View style={{ flex: 1 }}>
              <V2Text variant="title" numberOfLines={2}>
                {playlist.name}
              </V2Text>
              <V2Text variant="small" color="textSecondary">
                {tracks.length} songs · Yours
              </V2Text>
            </View>
          </View>
          {tracks.length > 0 ? (
            <View style={{ gap: v2Spacing.sm }}>
              <V2Button label="Play" onPress={() => playAt(0)} />
              <V2Button
                variant="secondary"
                disabled={pendingCount === 0}
                loading={downloadingAll}
                label={
                  downloadingAll
                    ? `Saving ${allDone}/${allTotal}${allFailed > 0 ? ` · ${allFailed} failed` : ''}`
                    : pendingCount === 0
                      ? 'All songs saved offline'
                      : `Save all offline (${pendingCount})`
                }
                onPress={downloadAll}
              />
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <V2Empty
          icon="musical-notes"
          title="Empty playlist"
          hint="Use “Add to playlist” on any song to fill it up."
        />
      }
      renderItem={({ item, index }) => (
        <V2TrackRow
          track={item}
          showFavorite
          showDownload
          onPress={() => playAt(index)}
          trailing={
            <Pressable
              onPress={() => removeFromPlaylist(playlist.id, item.id)}
              hitSlop={10}
              accessibilityLabel={`Remove ${item.title} from playlist`}
            >
              <Ionicons name="remove-circle-outline" size={22} color={v2Colors.textMuted} />
            </Pressable>
          }
        />
      )}
    />
  );
}

function V2PlaylistList({
  onBack,
  onImportSpotify,
}: {
  onBack: () => void;
  onImportSpotify: () => void;
}) {
  const playlists = useLibraryStore((s) => s.playlists);
  const addPlaylist = useLibraryStore((s) => s.addPlaylist);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    addPlaylist(name);
    setNewName('');
  };

  const open = playlists.find((p) => p.id === openId);
  if (open) {
    return <V2PlaylistDetail playlist={open} onBack={() => setOpenId(null)} />;
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: v2Spacing.xxxl }}>
      <V2Header title="Playlists" subtitle={`${playlists.length} playlists`} onBack={onBack} />
      <View style={{ flexDirection: 'row', gap: v2Spacing.xs, marginTop: v2Spacing.md }}>
        <View style={{ flex: 1 }}>
          <V2TextField
            value={newName}
            onChangeText={setNewName}
            placeholder="New playlist name"
            onSubmitEditing={create}
          />
        </View>
        <V2Button label="Create" onPress={create} disabled={!newName.trim()} compact />
      </View>
      <View style={{ marginTop: v2Spacing.sm }}>
        <V2Button label="Import from Spotify" variant="secondary" onPress={onImportSpotify} />
      </View>
      {playlists.length === 0 ? (
        <V2Empty
          icon="musical-notes"
          title="No playlists yet"
          hint="Name one above and tap Create."
        />
      ) : (
        <View style={{ marginTop: v2Spacing.md, gap: v2Spacing.xs }}>
          {playlists.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setOpenId(p.id)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: v2Spacing.sm,
                backgroundColor: v2Colors.surface,
                borderRadius: v2Radii.lg,
                padding: v2Spacing.sm,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <V2Artwork uri={playlistArtworkUrl(p.tracks)} size={52} />
              <View style={{ flex: 1 }}>
                <V2Text variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>
                  {p.name}
                </V2Text>
                <V2Text variant="small" color="textSecondary">
                  {p.tracks.length} songs
                </V2Text>
              </View>
              <Ionicons name={ROW_CHEVRON} size={18} color={v2Colors.textMuted} />
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// Ionicons don't auto-mirror; flip the chevron name so RTL reads "forward" too.
const ROW_CHEVRON = I18nManager.isRTL ? 'chevron-back' : 'chevron-forward';

const V2DownloadRow = memo(function V2DownloadRow({
  record,
  onPress,
}: {
  record: DownloadRecord;
  onPress: () => void;
}) {
  const removeDownload = useDownloadsStore((s) => s.removeDownload);
  const pauseDownload = useDownloadsStore((s) => s.pauseDownload);
  const resumeDownload = useDownloadsStore((s) => s.resumeDownload);
  const cancelDownload = useDownloadsStore((s) => s.cancelDownload);
  const retryDownload = useDownloadsStore((s) => s.retryDownload);
  const isPaused = useDownloadsStore((s) => s.pausedIds.has(record.jobId));
  const liveProgress = useDownloadProgressStore((s) => s.progress[record.jobId]);
  const liveSpeed = useDownloadProgressStore((s) => s.speeds[record.jobId]);
  const progress = liveProgress ?? (record.phase === 'completed' ? 100 : record.progress);
  const inFlight = record.phase === 'source' || record.phase === 'transfer';
  const subtitle = inFlight
    ? isPaused
      ? `Paused · ${progress}%`
      : record.phase === 'source'
        ? (record.error ?? 'Finding a source…')
        : `Saving · ${progress}%`
    : record.phase === 'completed'
      ? `${record.provider ?? 'Saved'} · Available offline`
      : (record.error || 'Download failed').slice(0, 140);

  return (
    <View
      style={{
        backgroundColor: v2Colors.surface,
        borderRadius: v2Radii.lg,
        padding: v2Spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: v2Spacing.sm }}>
        <Pressable
          onPress={onPress}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: v2Spacing.sm }}
          accessibilityLabel={`Play ${record.track.title}`}
        >
          <V2Artwork uri={record.track.artworkUrl} size={52} />
          <View style={{ flex: 1 }}>
            <V2Text variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>
              {record.track.title}
            </V2Text>
            <V2Text
              variant="small"
              color={record.phase === 'failed' ? 'error' : 'textSecondary'}
              numberOfLines={1}
            >
              {subtitle}
            </V2Text>
          </View>
        </Pressable>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          {inFlight && !isPaused && liveSpeed ? (
            <V2Text variant="caption" color="accent" style={{ fontWeight: '700' }}>
              {liveSpeed}
            </V2Text>
          ) : null}
          {inFlight ? (
            <V2Text variant="caption" color="textMuted" style={{ fontWeight: '700' }}>
              {progress}%
            </V2Text>
          ) : null}
          <Pressable
            onPress={() => void removeDownload(record.jobId)}
            hitSlop={10}
            accessibilityLabel="Delete download"
          >
            <Ionicons name="trash-outline" size={20} color={v2Colors.textMuted} />
          </Pressable>
        </View>
      </View>
      {inFlight ? (
        <View style={{ marginTop: v2Spacing.sm, gap: v2Spacing.sm }}>
          <View
            style={{
              height: 5,
              borderRadius: 3,
              backgroundColor: v2Colors.surfaceElevated,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                height: 5,
                width: `${progress}%`,
                backgroundColor: v2Colors.accent,
                borderRadius: 3,
              }}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: v2Spacing.lg }}>
            <Pressable
              hitSlop={8}
              onPress={() =>
                void (isPaused ? resumeDownload(record.jobId) : pauseDownload(record.jobId))
              }
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Ionicons name={isPaused ? 'play' : 'pause'} size={16} color={v2Colors.accent} />
              <V2Text variant="small" color="textSecondary" style={{ fontWeight: '600' }}>
                {isPaused ? 'Resume' : 'Pause'}
              </V2Text>
            </Pressable>
            <Pressable
              hitSlop={8}
              onPress={() => void cancelDownload(record.jobId)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Ionicons name="close" size={16} color={v2Colors.textMuted} />
              <V2Text variant="small" color="textSecondary" style={{ fontWeight: '600' }}>
                Cancel
              </V2Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {record.phase === 'failed' ? (
        <View style={{ marginTop: v2Spacing.sm, flexDirection: 'row', gap: v2Spacing.lg }}>
          <Pressable
            hitSlop={8}
            onPress={() => void retryDownload(record.jobId)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            accessibilityLabel={`Retry download of ${record.track.title}`}
          >
            <Ionicons name="refresh" size={16} color={v2Colors.accent} />
            <V2Text variant="small" color="textSecondary" style={{ fontWeight: '600' }}>
              Retry
            </V2Text>
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={() => void cancelDownload(record.jobId)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Ionicons name="close" size={16} color={v2Colors.textMuted} />
            <V2Text variant="small" color="textSecondary" style={{ fontWeight: '600' }}>
              Cancel
            </V2Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

function V2DownloadsView({ onBack }: { onBack: () => void }) {
  const navigation = useNavigation<LibraryNavigation>();
  const downloads = useDownloadsStore((s) => s.downloads);
  const completed = downloads.filter((d) => d.phase === 'completed');

  const playAll = useCallback(() => {
    if (completed.length === 0) return;
    void playerService.playQueue(
      completed.map((d) => d.track),
      0
    );
    navigation.navigate('Player');
  }, [completed, navigation]);

  if (downloads.length === 0) {
    return (
      <ScrollView style={{ flex: 1 }}>
        <V2Header title="Downloads" onBack={onBack} />
        <V2Empty
          icon="arrow-down-circle-outline"
          title="Nothing saved yet"
          hint="Tap the download icon on any song to keep it for offline listening."
        />
      </ScrollView>
    );
  }

  return (
    <FlatList
      style={{ flex: 1 }}
      data={downloads}
      keyExtractor={(item) => item.jobId}
      initialNumToRender={10}
      maxToRenderPerBatch={10}
      windowSize={7}
      contentContainerStyle={{ gap: v2Spacing.xs, paddingBottom: v2Spacing.xxxl }}
      ListHeaderComponent={
        <View style={{ gap: v2Spacing.md, marginBottom: v2Spacing.sm }}>
          <V2Header
            title="Downloads"
            subtitle={`${completed.length} saved offline`}
            onBack={onBack}
          />
          {completed.length > 0 ? <V2Button label="Play all offline" onPress={playAll} /> : null}
        </View>
      }
      renderItem={({ item }) => (
        <V2DownloadRow
          record={item}
          onPress={() => {
            if (item.phase !== 'completed') return;
            const idx = Math.max(
              0,
              completed.findIndex((d) => d.jobId === item.jobId)
            );
            void playerService.playQueue(
              completed.map((d) => d.track),
              idx
            );
            navigation.navigate('Player');
          }}
        />
      )}
    />
  );
}

/**
 * The download queue: songs waiting for a source or mid-transfer. The queue
 * keeps running while the user is elsewhere in the app (or with the screen
 * closed; transfers are native), so this view is purely observational —
 * pause still works per row.
 */
function V2QueueView({ onBack }: { onBack: () => void }) {
  const downloads = useDownloadsStore((s) => s.downloads);
  const queue = downloads.filter((d) => d.phase === 'source' || d.phase === 'transfer');

  return (
    <FlatList
      style={{ flex: 1 }}
      data={queue}
      keyExtractor={(item) => item.jobId}
      initialNumToRender={10}
      maxToRenderPerBatch={10}
      windowSize={7}
      contentContainerStyle={{ gap: v2Spacing.xs, paddingBottom: v2Spacing.xxxl }}
      ListHeaderComponent={
        <View style={{ gap: v2Spacing.md, marginBottom: v2Spacing.sm }}>
          <V2Header
            title="Download queue"
            subtitle={`${queue.length} ${queue.length === 1 ? 'song' : 'songs'} in line`}
            onBack={onBack}
          />
          <V2Text variant="small" color="textSecondary">
            Queues keep downloading in the background — you can leave this screen.
          </V2Text>
        </View>
      }
      ListEmptyComponent={
        <V2Empty
          icon="list"
          title="Queue is empty"
          hint="Use Download all on a saved playlist — everything you queue shows up here while it downloads."
        />
      }
      renderItem={({ item }) => <V2DownloadRow record={item} onPress={() => undefined} />}
    />
  );
}

function V2DiscoveryCard() {
  const preference = useLibraryStore((s) => s.discoveryPreference);
  const steps = 10;
  const active = Math.round(preference * steps);

  return (
    <View
      style={{
        backgroundColor: v2Colors.surface,
        borderRadius: v2Radii.lg,
        padding: v2Spacing.md,
        gap: v2Spacing.sm,
      }}
    >
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}
      >
        <V2Text variant="body" style={{ fontWeight: '700' }}>
          Discovery mix
        </V2Text>
        <V2Text variant="caption" color="textSecondary">
          {Math.round(preference * 100)}% new
        </V2Text>
      </View>
      <View
        style={{ flexDirection: 'row', gap: 4 }}
        accessibilityLabel={`Discovery preference ${Math.round(preference * 100)}%`}
      >
        {Array.from({ length: steps + 1 }, (_, i) => (
          <Pressable
            key={i}
            onPress={() => useLibraryStore.getState().setDiscoveryPreference(i / steps)}
            accessibilityRole="adjustable"
            accessibilityLabel={`Discovery level ${i}`}
            style={{
              flex: 1,
              height: 26,
              borderRadius: 8,
              backgroundColor: i <= active ? v2Colors.accent : v2Colors.surfaceElevated,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <V2Text variant="caption" color="textMuted">
          More familiar
        </V2Text>
        <V2Text variant="caption" color="textMuted">
          More new
        </V2Text>
      </View>
    </View>
  );
}

export function V2LibraryScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<LibraryNavigation>();
  const downloads = useDownloadsStore((s) => s.downloads);
  const softStatus = useUpdateStore((s) => s.softStatus);
  const latestRelease = useUpdateStore((s) => s.latest);
  const bannerDismissedFor = useUpdateStore((s) => s.bannerDismissedFor);
  const favoriteTracks = useLibraryStore((s) => s.favoriteTracks);
  const recentlyPlayed = useLibraryStore((s) => s.recentlyPlayed);
  const followedArtists = useLibraryStore((s) => s.followedArtists);
  const followedAlbums = useLibraryStore((s) => s.followedAlbums);
  const playlists = useLibraryStore((s) => s.playlists);
  const recentlyPlayedPlaylistIds = useLibraryStore((s) => s.recentlyPlayedPlaylistIds);
  const [view, setView] = useState<LibraryView>({ kind: 'root' });

  const recentPlaylists = useMemo(
    () =>
      recentlyPlayedPlaylistIds
        .map((id) => playlists.find((p) => p.id === id))
        .filter((p): p is LocalPlaylist => Boolean(p)),
    [recentlyPlayedPlaylistIds, playlists]
  );

  const downloadCounts = useMemo(() => {
    const completed = downloads.filter((d) => d.phase === 'completed').length;
    return { completed, active: downloads.length - completed };
  }, [downloads]);

  const body = (() => {
    switch (view.kind) {
      case 'favorites':
        return (
          <V2TrackList
            title="Liked songs"
            subtitle={`${favoriteTracks.length} songs`}
            tracks={favoriteTracks}
            onBack={() => setView({ kind: 'root' })}
            emptyIcon="heart-outline"
            emptyText="Tap the heart on any song to save it here."
          />
        );
      case 'recent':
        return (
          <V2TrackList
            title="Recently played"
            subtitle={`${recentlyPlayed.length} songs`}
            tracks={recentlyPlayed}
            onBack={() => setView({ kind: 'root' })}
            emptyIcon="time-outline"
            emptyText="Songs you play will show up here."
          />
        );
      case 'playlist':
        return (
          <V2PlaylistDetail
            playlist={playlists.find((p) => p.id === view.playlist.id) ?? view.playlist}
            onBack={() => setView({ kind: 'playlists' })}
          />
        );
      case 'playlists':
        return (
          <V2PlaylistList
            onBack={() => setView({ kind: 'root' })}
            onImportSpotify={() => setView({ kind: 'spotify-import' })}
          />
        );
      case 'spotify-import':
        return <V2SpotifyImportScreen onBack={() => setView({ kind: 'playlists' })} />;
      case 'downloads':
        return <V2DownloadsView onBack={() => setView({ kind: 'root' })} />;
      case 'queue':
        return <V2QueueView onBack={() => setView({ kind: 'root' })} />;
      case 'settings':
        return (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: v2Spacing.xxxl }}>
            <V2Header title="Settings" onBack={() => setView({ kind: 'root' })} />
            <View style={{ gap: v2Spacing.md, marginTop: v2Spacing.md }}>
              <V2DiscoveryCard />
              <SecuritySettings onBack={() => setView({ kind: 'root' })} />
            </View>
          </ScrollView>
        );
      case 'about':
        return <AboutUpdatesView onBack={() => setView({ kind: 'root' })} />;
      case 'root':
      default:
        return (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: v2Spacing.xxxl }}
            showsVerticalScrollIndicator={false}
          >
            <V2Text variant="display">Your Library</V2Text>
            <V2Text variant="body" color="textSecondary" style={{ marginTop: 2 }}>
              Everything you saved, offline-ready
            </V2Text>

            {latestRelease &&
            softStatus === 'available' &&
            bannerDismissedFor !== latestRelease.versionName ? (
              <View
                style={{
                  backgroundColor: v2Colors.surface,
                  borderRadius: v2Radii.lg,
                  padding: v2Spacing.md,
                  marginTop: v2Spacing.md,
                  gap: v2Spacing.xs,
                }}
              >
                <V2Text variant="body" style={{ fontWeight: '700' }}>
                  Sinc {latestRelease.versionName} is available
                </V2Text>
                <V2Text variant="small" color="textSecondary">
                  New release with fixes and features — tap to download.
                </V2Text>
                <View style={{ flexDirection: 'row', gap: v2Spacing.sm, marginTop: v2Spacing.xs }}>
                  <View style={{ flex: 1 }}>
                    <V2Button
                      label="Update"
                      onPress={() => {
                        void useUpdateStore.getState().dismissBanner();
                        void Linking.openURL(config.githubReleasePageUrl);
                      }}
                      compact
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <V2Button
                      label="Later"
                      variant="secondary"
                      onPress={() => void useUpdateStore.getState().dismissBanner()}
                      compact
                    />
                  </View>
                </View>
              </View>
            ) : null}

            <View style={{ marginTop: v2Spacing.md }}>
              <V2DiscoveryCard />
            </View>

            {recentPlaylists.length > 0 ? (
              <View style={{ marginTop: v2Spacing.lg }}>
                <V2Text variant="headline" style={{ marginBottom: v2Spacing.sm }}>
                  Jump back in
                </V2Text>
                <View style={{ gap: v2Spacing.xs }}>
                  {recentPlaylists.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => setView({ kind: 'playlist', playlist: p })}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: v2Spacing.sm,
                        backgroundColor: v2Colors.surface,
                        borderRadius: v2Radii.lg,
                        padding: v2Spacing.sm,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <V2Artwork uri={playlistArtworkUrl(p.tracks)} size={52} />
                      <View style={{ flex: 1 }}>
                        <V2Text variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>
                          {p.name}
                        </V2Text>
                        <V2Text variant="small" color="textSecondary">
                          {p.tracks.length} songs
                        </V2Text>
                      </View>
                      <Ionicons name={ROW_CHEVRON} size={18} color={v2Colors.textMuted} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={{ marginTop: v2Spacing.lg }}>
              <V2Text variant="headline" style={{ marginBottom: v2Spacing.sm }}>
                Library
              </V2Text>
              <View style={{ gap: v2Spacing.xs }}>
                <V2MenuRow
                  icon="heart"
                  iconColor={v2Colors.error}
                  title="Liked songs"
                  subtitle={
                    favoriteTracks.length === 0
                      ? 'No liked songs yet'
                      : `${favoriteTracks.length} songs`
                  }
                  onPress={() => setView({ kind: 'favorites' })}
                />
                <V2MenuRow
                  icon="time"
                  title="Recently played"
                  subtitle={
                    recentlyPlayed.length === 0
                      ? 'Nothing played yet'
                      : `${recentlyPlayed.length} songs`
                  }
                  onPress={() => setView({ kind: 'recent' })}
                />
                <V2MenuRow
                  icon="musical-notes"
                  title="Playlists"
                  subtitle={
                    playlists.length === 0 ? 'No playlists yet' : `${playlists.length} playlists`
                  }
                  onPress={() => setView({ kind: 'playlists' })}
                />
                <V2MenuRow
                  icon="arrow-down-circle"
                  iconColor={v2Colors.accent}
                  title="Downloads"
                  subtitle={
                    downloadCounts.active > 0
                      ? `${downloadCounts.active} in progress`
                      : downloadCounts.completed === 0
                        ? 'No downloads yet'
                        : `${downloadCounts.completed} saved offline`
                  }
                  badge={downloadCounts.active > 0 ? `${downloadCounts.active}` : undefined}
                  onPress={() => setView({ kind: 'downloads' })}
                />
                <V2MenuRow
                  icon="cloud-download"
                  title="Download a playlist"
                  subtitle="From any Spotify playlist link"
                  onPress={() => setView({ kind: 'spotify-import' })}
                />
                <V2MenuRow
                  icon="list"
                  title="Download queue"
                  subtitle={
                    downloadCounts.active === 0
                      ? 'Nothing in the queue'
                      : `${downloadCounts.active} downloading`
                  }
                  badge={downloadCounts.active > 0 ? `${downloadCounts.active}` : undefined}
                  onPress={() => setView({ kind: 'queue' })}
                />
              </View>
            </View>

            <View style={{ marginTop: v2Spacing.lg }}>
              <V2Text variant="headline" style={{ marginBottom: v2Spacing.sm }}>
                Settings
              </V2Text>
              <View style={{ gap: v2Spacing.xs }}>
                <V2MenuRow
                  icon="settings"
                  title="Settings"
                  subtitle="Discovery & app lock"
                  onPress={() => setView({ kind: 'settings' })}
                />
                <V2MenuRow
                  icon="information-circle"
                  title="About & updates"
                  subtitle={
                    softStatus === 'available' ? 'Update available' : 'Version & app updates'
                  }
                  badge={softStatus === 'available' ? 'NEW' : undefined}
                  onPress={() => setView({ kind: 'about' })}
                />
              </View>
            </View>

            {followedArtists.length > 0 ? (
              <View style={{ marginTop: v2Spacing.lg }}>
                <V2Text variant="headline" style={{ marginBottom: v2Spacing.sm }}>
                  Artists
                </V2Text>
                <View>
                  {followedArtists.map((artist) => (
                    <Pressable
                      key={artist.id}
                      onPress={() =>
                        navigation.navigate('Artist', { id: artist.id, name: artist.name })
                      }
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: v2Spacing.sm,
                        paddingVertical: v2Spacing.xs,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <V2Artwork uri={artist.artworkUrl} size={52} radius={26} />
                      <V2Text
                        variant="body"
                        style={{ fontWeight: '600', flex: 1 }}
                        numberOfLines={1}
                      >
                        {artist.name}
                      </V2Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {followedAlbums.length > 0 ? (
              <View style={{ marginTop: v2Spacing.lg }}>
                <V2Text variant="headline" style={{ marginBottom: v2Spacing.sm }}>
                  Albums
                </V2Text>
                <View>
                  {followedAlbums.map((album) => (
                    <Pressable
                      key={album.id}
                      onPress={() =>
                        navigation.navigate('Album', { id: album.id, title: album.title })
                      }
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: v2Spacing.sm,
                        paddingVertical: v2Spacing.xs,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <V2Artwork uri={album.artworkUrl} size={52} />
                      <View style={{ flex: 1 }}>
                        <V2Text variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>
                          {album.title}
                        </V2Text>
                        <V2Text variant="small" color="textSecondary" numberOfLines={1}>
                          {album.artist.name}
                        </V2Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>
        );
    }
  })();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: v2Colors.background,
        paddingTop: insets.top + v2Spacing.sm,
        paddingHorizontal: v2Spacing.md,
      }}
    >
      {body}
    </View>
  );
}
