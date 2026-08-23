import { useCallback, useMemo, useState, memo } from 'react';
import Ionicons from '@react-native-vector-icons/ionicons';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CanonicalTrack } from '@sinc/shared';
import { AppText } from '../../components/AppText';
import { SongRow } from '../../components/SongRow';
import { ArtistRow } from '../../components/ArtistRow';
import { AlbumRow } from '../../components/AlbumRow';
import { AppButton } from '../../components/AppButton';
import { SecuritySettings } from '../lock/SecuritySettings';
import { SpotifyImportScreen } from './SpotifyImportScreen';
import { useTheme } from '../../theme';
import { playerService } from '../../services/player/PlayerService';
import { useLibraryStore, type LocalPlaylist } from '../../services/library/libraryStore';
import { PlaylistCover } from '../../components/PlaylistCover';
import { useAuthStore } from '../auth/authStore';
import { useDownloadsStore, type DownloadRecord } from '../../services/library/downloadsStore';
import { useDownloadProgressStore } from '../../services/library/downloadProgressStore';
import type { MainTabParamList, RootStackParamList } from '../../app/navigation/types';
import { chevronIcon } from '../../utils/rtl';

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
  | { kind: 'settings' };

function SectionRow({
  icon,
  iconColor,
  title,
  subtitle,
  onPress,
}: {
  icon: string;
  iconColor: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const { colors, spacing, radii } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.sectionRow,
        { padding: spacing.sm },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.iconTile, { backgroundColor: iconColor, borderRadius: radii.md }]}>
        <Ionicons name={icon as never} size={22} color={colors.onAccent} />
      </View>
      <View style={styles.sectionText}>
        <AppText variant="body" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="small" color="textSecondary" numberOfLines={1}>
          {subtitle}
        </AppText>
      </View>
      <Ionicons name={chevronIcon('forward')} size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function SectionHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={[styles.sectionHeader, { marginTop: spacing.md }]}>
      <Pressable
        onPress={onBack}
        hitSlop={8}
        style={styles.backButton}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name={chevronIcon('back')} size={24} color={colors.textPrimary} />
      </Pressable>
      <AppText variant="headline" style={styles.sectionHeaderTitle}>
        {title}
      </AppText>
      <View style={{ width: 32 }} />
    </View>
  );
}

const TRACK_ROW_HEIGHT = 64;

function TrackListView({
  title,
  tracks,
  onBack,
  emptyText,
}: {
  title: string;
  tracks: CanonicalTrack[];
  onBack: () => void;
  emptyText: string;
}) {
  const navigation = useNavigation<LibraryNavigation>();
  const { colors, spacing } = useTheme();

  const playAll = useCallback(() => {
    if (tracks.length === 0) return;
    void playerService.playQueue(tracks, 0);
    navigation.navigate('Player');
  }, [tracks, navigation]);

  const onPressTrack = useCallback(
    (queue: CanonicalTrack[], index: number) => {
      void playerService.playQueue(queue, index);
      navigation.navigate('Player');
    },
    [navigation]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: CanonicalTrack; index: number }) => (
      <SongRow
        track={item}
        showFavorite
        showAdd
        showDownload
        onPress={() => onPressTrack(tracks, index)}
      />
    ),
    [onPressTrack, tracks]
  );

  if (tracks.length === 0) {
    return (
      <ScrollView style={{ backgroundColor: colors.background, flex: 1 }}>
        <SectionHeader title={title} onBack={onBack} />
        <AppText variant="body" color="textSecondary" style={styles.emptyText}>
          {emptyText}
        </AppText>
      </ScrollView>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.background, flex: 1 }}
      data={tracks}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      getItemLayout={(_, index) => ({
        length: TRACK_ROW_HEIGHT,
        offset: TRACK_ROW_HEIGHT * index,
        index,
      })}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      ListHeaderComponent={
        <>
          <SectionHeader title={title} onBack={onBack} />
          <View style={{ padding: spacing.md }}>
            <AppButton label="Play all" onPress={playAll} style={{ marginBottom: spacing.sm }} />
          </View>
        </>
      }
      contentContainerStyle={{ paddingBottom: 48 }}
    />
  );
}

function PlaylistDetailView({ playlist, onBack }: { playlist: LocalPlaylist; onBack: () => void }) {
  const navigation = useNavigation<LibraryNavigation>();
  const { colors, spacing } = useTheme();

  const tracks = playlist.tracks;

  const playAll = useCallback(() => {
    if (tracks.length === 0) return;
    useLibraryStore.getState().recordPlaylistPlayed(playlist.id);
    void playerService.playQueue(tracks, 0);
    navigation.navigate('Player');
  }, [tracks, playlist.id, navigation]);

  const onPressTrack = useCallback(
    (queue: CanonicalTrack[], index: number) => {
      useLibraryStore.getState().recordPlaylistPlayed(playlist.id);
      void playerService.playQueue(queue, index);
      navigation.navigate('Player');
    },
    [playlist.id, navigation]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: CanonicalTrack; index: number }) => (
      <SongRow
        track={item}
        showFavorite
        showAdd
        showDownload
        onPress={() => onPressTrack(tracks, index)}
      />
    ),
    [onPressTrack, tracks]
  );

  if (tracks.length === 0) {
    return (
      <ScrollView style={{ backgroundColor: colors.background, flex: 1 }}>
        <SectionHeader title={playlist.name} onBack={onBack} />
        <AppText variant="body" color="textSecondary" style={styles.emptyText}>
          No tracks yet. Use "Add to playlist" on any song.
        </AppText>
        <View style={{ padding: spacing.md }}>
          <AppButton
            variant="ghost"
            label="Delete playlist"
            onPress={() => {
              useLibraryStore.getState().deletePlaylist(playlist.id);
              onBack();
            }}
          />
        </View>
      </ScrollView>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.background, flex: 1 }}
      data={tracks}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      getItemLayout={(_, index) => ({
        length: TRACK_ROW_HEIGHT,
        offset: TRACK_ROW_HEIGHT * index,
        index,
      })}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      ListHeaderComponent={
        <>
          <SectionHeader title={playlist.name} onBack={onBack} />
          <View
            style={{
              paddingHorizontal: spacing.md,
              flexDirection: 'row',
              gap: spacing.md,
              alignItems: 'center',
            }}
          >
            <PlaylistCover tracks={tracks} size={96} borderRadius={12} />
            <View style={{ flex: 1 }}>
              <AppText variant="headline" numberOfLines={2}>
                {playlist.name}
              </AppText>
              <AppText variant="small" color="textSecondary">
                {tracks.length} songs
              </AppText>
            </View>
          </View>
          <View style={{ padding: spacing.md }}>
            <AppButton label="Play all" onPress={playAll} style={{ marginBottom: spacing.sm }} />
          </View>
        </>
      }
      ListFooterComponent={
        <View style={{ padding: spacing.md }}>
          <AppButton
            variant="ghost"
            label="Delete playlist"
            onPress={() => {
              useLibraryStore.getState().deletePlaylist(playlist.id);
              onBack();
            }}
          />
        </View>
      }
      contentContainerStyle={{ paddingBottom: 48 }}
    />
  );
}

function PlaylistListView({
  onBack,
  onImportSpotify,
}: {
  onBack: () => void;
  onImportSpotify: () => void;
}) {
  const { colors, spacing, radii } = useTheme();
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
    return <PlaylistDetailView playlist={open} onBack={() => setOpenId(null)} />;
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background, flex: 1 }}>
      <SectionHeader title="Playlists" onBack={onBack} />
      <View style={{ padding: spacing.md, gap: spacing.xxs }}>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="New playlist name"
            placeholderTextColor={colors.textMuted}
            onSubmitEditing={create}
            style={[
              styles.playlistInput,
              {
                backgroundColor: colors.surfaceElevated,
                borderRadius: radii.md,
                color: colors.textPrimary,
              },
            ]}
          />
          <AppButton label="Create" onPress={create} disabled={!newName.trim()} />
        </View>
        <AppButton
          variant="secondary"
          label="Import from Spotify"
          onPress={onImportSpotify}
          style={{ marginBottom: spacing.sm }}
        />
        {playlists.length === 0 ? (
          <AppText variant="body" color="textSecondary" style={styles.emptyText}>
            No playlists yet. Type a name above and tap Create.
          </AppText>
        ) : (
          playlists.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setOpenId(p.id)}
              style={({ pressed }) => [
                styles.sectionRow,
                { padding: spacing.sm },
                pressed && styles.pressed,
              ]}
            >
              <PlaylistCover tracks={p.tracks} size={48} borderRadius={12} />
              <View style={styles.sectionText}>
                <AppText variant="body" numberOfLines={1}>
                  {p.name}
                </AppText>
                <AppText variant="small" color="textSecondary">
                  {p.tracks.length} songs
                </AppText>
              </View>
              <Ionicons name={chevronIcon('forward')} size={18} color="#7A7A7A" />
            </Pressable>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const DownloadRow = memo(function DownloadRow({
  record,
  onPress,
}: {
  record: DownloadRecord;
  onPress: () => void;
}) {
  const { colors, spacing, radii } = useTheme();
  const removeDownload = useDownloadsStore((s) => s.removeDownload);
  const liveProgress = useDownloadProgressStore((s) => s.progress[record.jobId]);
  const progress = liveProgress ?? (record.phase === 'completed' ? 100 : record.progress);
  const inFlight = record.phase === 'source' || record.phase === 'transfer';
  const subtitle = inFlight
    ? record.phase === 'source'
      ? 'Resolving source…'
      : `Saving ${progress}%`
    : record.phase === 'completed'
      ? `${record.provider ?? 'Downloaded'} · Offline`
      : 'Download failed';

  return (
    <View style={[styles.sectionRow, { padding: spacing.sm }]}>
      <Pressable
        onPress={onPress}
        style={styles.downloadRowMain}
        accessibilityLabel={`Play ${record.track.title}`}
      >
        <Image
          source={record.track.artworkUrl ? { uri: record.track.artworkUrl } : undefined}
          style={[styles.downloadArtwork, { borderRadius: radii.sm }]}
        />
        <View style={styles.sectionText}>
          <AppText variant="body" numberOfLines={1}>
            {record.track.title}
          </AppText>
          <AppText variant="small" color="textSecondary" numberOfLines={1}>
            {subtitle}
          </AppText>
          {inFlight ? (
            <View
              style={[
                styles.progressTrack,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderRadius: radii.sm,
                  marginTop: spacing.sm,
                },
              ]}
            >
              <View
                style={[
                  styles.progressFill,
                  { width: `${progress}%`, backgroundColor: colors.accent, borderRadius: radii.sm },
                ]}
              />
            </View>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        onPress={() => void removeDownload(record.jobId)}
        hitSlop={8}
        accessibilityLabel="Delete download"
      >
        <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
      </Pressable>
    </View>
  );
});

function DownloadsView({ onBack }: { onBack: () => void }) {
  const navigation = useNavigation<LibraryNavigation>();
  const { colors, spacing } = useTheme();
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

  const renderItem = useCallback(
    ({ item }: { item: DownloadRecord }) => (
      <DownloadRow
        record={item}
        onPress={() => {
          if (item.phase !== 'completed') return;
          void playerService.playQueue(
            completed.map((d) => d.track),
            Math.max(
              0,
              completed.findIndex((d) => d.jobId === item.jobId)
            )
          );
          navigation.navigate('Player');
        }}
      />
    ),
    [completed, navigation]
  );

  if (downloads.length === 0) {
    return (
      <ScrollView style={{ backgroundColor: colors.background, flex: 1 }}>
        <SectionHeader title="Downloads" onBack={onBack} />
        <AppText variant="body" color="textSecondary" style={styles.emptyText}>
          Nothing downloaded yet. Tap the download icon next to any song to save it for offline
          listening.
        </AppText>
      </ScrollView>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.background, flex: 1 }}
      data={downloads}
      renderItem={renderItem}
      keyExtractor={(item) => item.jobId}
      initialNumToRender={10}
      maxToRenderPerBatch={10}
      windowSize={7}
      ListHeaderComponent={
        <>
          <SectionHeader title="Downloads" onBack={onBack} />
          {completed.length > 0 ? (
            <View style={{ padding: spacing.md }}>
              <AppButton label="Play all offline" onPress={playAll} />
            </View>
          ) : null}
        </>
      }
      contentContainerStyle={{ paddingBottom: 48 }}
    />
  );
}

export function LibraryScreen() {
  const { colors, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<LibraryNavigation>();
  const user = useAuthStore((s) => s.user);
  const downloads = useDownloadsStore((s) => s.downloads);
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

  if (view.kind === 'favorites') {
    return (
      <TrackListView
        title="Liked songs"
        tracks={favoriteTracks}
        onBack={() => setView({ kind: 'root' })}
        emptyText="Tap the heart on any song to save it here."
      />
    );
  }

  if (view.kind === 'recent') {
    return (
      <TrackListView
        title="Recently played"
        tracks={recentlyPlayed}
        onBack={() => setView({ kind: 'root' })}
        emptyText="Songs you play will show up here."
      />
    );
  }

  if (view.kind === 'playlist') {
    return (
      <PlaylistDetailView playlist={view.playlist} onBack={() => setView({ kind: 'playlists' })} />
    );
  }

  if (view.kind === 'playlists') {
    return (
      <PlaylistListView
        onBack={() => setView({ kind: 'root' })}
        onImportSpotify={() => setView({ kind: 'spotify-import' })}
      />
    );
  }

  if (view.kind === 'spotify-import') {
    return <SpotifyImportScreen onBack={() => setView({ kind: 'playlists' })} />;
  }

  if (view.kind === 'downloads') {
    return <DownloadsView onBack={() => setView({ kind: 'root' })} />;
  }

  if (view.kind === 'settings') {
    return <SecuritySettings onBack={() => setView({ kind: 'root' })} />;
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background, flex: 1 }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
    >
      <AppText variant="display">Your Library</AppText>

      {recentPlaylists.length > 0 ? (
        <View style={{ marginTop: spacing.lg }}>
          <AppText variant="headline">Last played playlists</AppText>
          <View style={{ marginTop: spacing.sm, gap: spacing.xxs }}>
            {recentPlaylists.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setView({ kind: 'playlist', playlist: p })}
                style={({ pressed }) => [
                  styles.sectionRow,
                  { padding: spacing.sm },
                  pressed && styles.pressed,
                ]}
              >
                <PlaylistCover tracks={p.tracks} size={48} borderRadius={12} />
                <View style={styles.sectionText}>
                  <AppText variant="body" numberOfLines={1}>
                    {p.name}
                  </AppText>
                  <AppText variant="small" color="textSecondary" numberOfLines={1}>
                    {p.tracks.length} songs
                  </AppText>
                </View>
                <Ionicons name={chevronIcon('forward')} size={18} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
        <SectionRow
          icon="heart"
          iconColor="#E0245E"
          title="Liked songs"
          subtitle={
            favoriteTracks.length === 0 ? 'No liked songs yet' : `${favoriteTracks.length} songs`
          }
          onPress={() => setView({ kind: 'favorites' })}
        />
        <SectionRow
          icon="time"
          iconColor="#1DA1F2"
          title="Recently played"
          subtitle={
            recentlyPlayed.length === 0 ? 'Nothing played yet' : `${recentlyPlayed.length} songs`
          }
          onPress={() => setView({ kind: 'recent' })}
        />
        <SectionRow
          icon="musical-notes"
          iconColor="#7B5DD6"
          title="Playlists"
          subtitle={playlists.length === 0 ? 'No playlists yet' : `${playlists.length} playlists`}
          onPress={() => setView({ kind: 'playlists' })}
        />
        <SectionRow
          icon="download"
          iconColor="#1DB954"
          title="Downloads"
          subtitle={
            downloadCounts.active > 0
              ? `${downloadCounts.active} in progress`
              : downloadCounts.completed === 0
                ? 'No downloads yet'
                : `${downloadCounts.completed} saved offline`
          }
          onPress={() => setView({ kind: 'downloads' })}
        />
        <SectionRow
          icon="lock-closed"
          iconColor="#7A7A7A"
          title="Security"
          subtitle="PIN & biometric app lock"
          onPress={() => setView({ kind: 'settings' })}
        />
        {user?.role === 'admin' ? (
          <SectionRow
            icon="shield-checkmark"
            iconColor="#F5A623"
            title="Admin"
            subtitle="Users, sessions, audit log & MFA"
            onPress={() => navigation.navigate('Admin')}
          />
        ) : null}
      </View>

      {followedArtists.length > 0 ? (
        <View style={{ marginTop: spacing.xl }}>
          <AppText variant="headline">Artists</AppText>
          <View style={{ marginTop: spacing.sm, gap: spacing.xxs }}>
            {followedArtists.map((artist) => (
              <ArtistRow
                key={artist.id}
                artist={artist}
                onPress={() => navigation.navigate('Artist', { id: artist.id, name: artist.name })}
              />
            ))}
          </View>
        </View>
      ) : null}

      {followedAlbums.length > 0 ? (
        <View style={{ marginTop: spacing.xl }}>
          <AppText variant="headline">Albums</AppText>
          <View style={{ marginTop: spacing.sm, gap: spacing.xxs }}>
            {followedAlbums.map((album) => (
              <AlbumRow
                key={album.id}
                album={album}
                onPress={() => navigation.navigate('Album', { id: album.id, title: album.title })}
              />
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconTile: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionText: {
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  sectionHeaderTitle: {
    flex: 1,
    textAlign: 'center',
  },
  backButton: {
    width: 32,
  },
  playlistInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 24,
  },
  pressed: {
    opacity: 0.7,
  },
  downloadRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  downloadArtwork: {
    width: 48,
    height: 48,
    backgroundColor: '#222',
  },
  progressTrack: {
    height: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
  },
});
