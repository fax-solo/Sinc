import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { CanonicalAlbum, CanonicalArtist, CanonicalTrack } from '@sinc/shared';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { SearchInput, FilterChip } from '../components/Fields';
import { SongRow } from '../components/SongRow';
import { Artwork } from '../components/Artwork';
import { IconButton, TextButton } from '../components/Buttons';
import { BottomSheet, ConfirmDialog, SheetRow, toast } from '../components/Overlays';
import { EmptyState, Pill } from '../components/State';
import { colors, radii, spacing } from '../theme';
import { useLibraryStore, type LocalPlaylist } from '../../services/library/libraryStore';
import { isDownloadInProgress, useDownloadsStore } from '../../services/library/downloadsStore';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { playerService } from '../../services/player/PlayerService';
import { openSongMenu } from '../songMenu/songMenuStore';
import { shuffled } from '../../services/local/affinity';
import { playlistArtworkUrl } from '../../components/PlaylistCover';
import { TrackSelectionFooter } from '../selection/TrackSelectionFooter';
import { useTrackSelection } from '../selection/useTrackSelection';
import type {
  LibraryCategory,
  MainTabParamList,
  RootStackParamList,
} from '../../app/navigation/types';

type Category = LibraryCategory;

const CATEGORIES: Array<{ key: Category; label: string }> = [
  { key: 'Playlists', label: 'Playlists' },
  { key: 'Albums', label: 'Albums' },
  { key: 'Artists', label: 'Artists' },
  { key: 'Downloads', label: 'Downloaded' },
  { key: 'Liked', label: 'Liked songs' },
];

type LibraryItem =
  | { type: 'playlist'; playlist: LocalPlaylist }
  | { type: 'album'; album: CanonicalAlbum }
  | { type: 'artist'; artist: CanonicalArtist }
  | { type: 'track'; track: CanonicalTrack; source: 'download' | 'liked' };

export function LibraryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<MainTabParamList, 'Library'>>();
  const [category, setCategory] = useState<Category>(route.params?.category ?? 'Playlists');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sortOpen, setSortOpen] = useState(false);
  const [sort, setSort] = useState<'recent' | 'az'>('recent');
  const [playlistActions, setPlaylistActions] = useState<LocalPlaylist | null>(null);
  const [savedActions, setSavedActions] = useState<LibraryItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LocalPlaylist | null>(null);
  const selection = useTrackSelection();
  const cancelSelection = selection.cancel;

  const playlists = useLibraryStore((state) => state.playlists);
  const favoriteTracks = useLibraryStore((state) => state.favoriteTracks);
  const followedArtists = useLibraryStore((state) => state.followedArtists);
  const followedAlbums = useLibraryStore((state) => state.followedAlbums);
  const artistPlayStats = useLibraryStore((state) => state.artistPlayStats);
  const deletePlaylist = useLibraryStore((state) => state.deletePlaylist);
  const duplicatePlaylist = useLibraryStore((state) => state.duplicatePlaylist);
  const recordPlaylistPlayed = useLibraryStore((state) => state.recordPlaylistPlayed);
  const toggleFollowAlbum = useLibraryStore((state) => state.toggleFollowAlbum);
  const toggleFollowArtist = useLibraryStore((state) => state.toggleFollowArtist);
  const downloads = useDownloadsStore((state) => state.downloads);
  const downloadTrack = useDownloadsStore((state) => state.downloadTrack);
  const activeDownloads = downloads.filter((record) => isDownloadInProgress(record.phase));
  const completed = useMemo(
    () => downloads.filter((record) => record.phase === 'completed' && record.localUri),
    [downloads]
  );
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const playing = usePlayerStore((state) => state.status === 'playing');

  const selectCategory = (next: Category) => {
    setCategory(next);
    setQuery('');
    setSearchOpen(false);
  };

  useEffect(() => {
    const requested = route.params?.category;
    if (!requested) return;
    // Route params are a one-shot request from another screen. Applying them
    // inside an effect keeps this screen's local category selection intact
    // when the user returns to the tab later.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    selectCategory(requested);
    (
      navigation as unknown as {
        setParams: (params: Record<string, unknown>) => void;
      }
    ).setParams({ category: undefined });
    // selectCategory is intentionally excluded: it only closes over setters.
  }, [route.params?.category, navigation]);

  const trimmed = query.trim().toLowerCase();

  const items = useMemo<LibraryItem[]>(() => {
    const matches = (...values: Array<string | undefined>) =>
      !trimmed || values.some((value) => value?.toLowerCase().includes(trimmed));

    if (category === 'Playlists') {
      return playlists
        .filter((playlist) => matches(playlist.name, playlist.description))
        .sort((a, b) => (sort === 'az' ? a.name.localeCompare(b.name) : b.updatedAt - a.updatedAt))
        .map((playlist) => ({ type: 'playlist' as const, playlist }));
    }
    if (category === 'Albums') {
      return followedAlbums
        .filter((album) => matches(album.title, album.artist?.name))
        .sort((a, b) =>
          sort === 'az'
            ? a.title.localeCompare(b.title)
            : (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '')
        )
        .map((album) => ({ type: 'album' as const, album }));
    }
    if (category === 'Artists') {
      return followedArtists
        .filter((artist) => matches(artist.name))
        .sort((a, b) =>
          sort === 'az'
            ? a.name.localeCompare(b.name)
            : (artistPlayStats[b.name] ?? 0) - (artistPlayStats[a.name] ?? 0)
        )
        .map((artist) => ({ type: 'artist' as const, artist }));
    }
    if (category === 'Downloads') {
      const sorted = [...completed].sort((a, b) =>
        sort === 'az'
          ? a.track.title.localeCompare(b.track.title)
          : (b.completedAt ?? 0) - (a.completedAt ?? 0)
      );
      return sorted
        .filter((record) =>
          matches(record.track.title, record.track.artists.map((artist) => artist.name).join(' '))
        )
        .map((record) => ({
          type: 'track' as const,
          track: record.track,
          source: 'download' as const,
        }));
    }
    return favoriteTracks
      .filter((track) => matches(track.title, track.artists.map((artist) => artist.name).join(' ')))
      .sort((a, b) => (sort === 'az' ? a.title.localeCompare(b.title) : 0))
      .map((track) => ({ type: 'track' as const, track, source: 'liked' as const }));
  }, [
    category,
    playlists,
    followedAlbums,
    followedArtists,
    completed,
    favoriteTracks,
    artistPlayStats,
    sort,
    trimmed,
  ]);

  const downloadedIds = useMemo(
    () => new Set(completed.map((record) => record.track.id)),
    [completed]
  );

  /** The visible, filtered subset is also what Play/Shuffle act on. */
  const visibleTracks = useMemo(
    () => items.flatMap((item) => (item.type === 'track' ? [item.track] : [])),
    [items]
  );

  useEffect(() => {
    // Filters are a different visible set; stale hidden selections would make
    // the footer count actions the user cannot see.
    cancelSelection();
  }, [category, trimmed, cancelSelection]);

  const playTrackList = (tracks: CanonicalTrack[], startIndex = 0, shuffle = false) => {
    if (tracks.length === 0) return;
    const queue = shuffle ? shuffled(tracks, Math.random) : tracks;
    void playerService.playQueue(queue, shuffle ? 0 : startIndex);
  };

  const playSelected = () => {
    playTrackList(visibleTracks);
  };

  const shuffleSelected = () => {
    playTrackList(visibleTracks, 0, true);
  };

  const downloadPlaylist = async (playlist: LocalPlaylist) => {
    setPlaylistActions(null);
    const missing = playlist.tracks.filter((track) => {
      if (downloadedIds.has(track.id)) return false;
      const existing = useDownloadsStore.getState().getDownload(track.id);
      return !existing || !isDownloadInProgress(existing.phase);
    });
    if (missing.length === 0) {
      toast('All songs are already downloaded or downloading', 'default');
      return;
    }
    toast(`Downloading ${missing.length} song${missing.length === 1 ? '' : 's'}`, 'success');
    // Start jobs at a short cadence so source resolution does not stampede.
    // Each download continues in the background and reports through the
    // Downloads queue; waiting for every full transfer here would freeze the
    // action for minutes.
    for (const track of missing) {
      void downloadTrack(track, { priority: 'bulk' }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  };

  const openPlaylist = (playlist: LocalPlaylist) => {
    setPlaylistActions(null);
    navigation.navigate('LocalPlaylist', { id: playlist.id });
  };

  const header = (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: spacing.sm,
        }}
      >
        <Text variant="display">Your Library</Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          <IconButton
            icon="search"
            label={searchOpen ? 'Close library search' : 'Search your library'}
            size={40}
            background={colors.card}
            onPress={() => {
              if (searchOpen) setQuery('');
              setSearchOpen((open) => !open);
            }}
          />
          <IconButton
            icon="add"
            label="Create playlist"
            size={40}
            background={colors.accent}
            color={colors.onAccent}
            onPress={() => navigation.navigate('PlaylistEditor', { mode: 'create' })}
          />
        </View>
      </View>

      {searchOpen ? (
        <SearchInput
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${category.toLowerCase()}`}
          containerStyle={{ marginTop: spacing.md }}
          autoFocus
        />
      ) : null}

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={CATEGORIES}
        keyExtractor={(item) => item.key}
        style={{ marginTop: spacing.md, marginBottom: spacing.md }}
        contentContainerStyle={{ gap: spacing.xs }}
        renderItem={({ item }) => (
          <FilterChip
            label={item.label}
            active={category === item.key}
            onPress={() => selectCategory(item.key)}
          />
        )}
      />

      {activeDownloads.length > 0 && category !== 'Downloads' ? (
        <Pressable
          onPress={() => navigation.navigate('Downloads')}
          accessibilityRole="button"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            backgroundColor: colors.accentSoft,
            borderRadius: radii.md,
            padding: spacing.md,
            marginBottom: spacing.md,
          }}
        >
          <Ionicons name="cloud-download" size={20} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" style={{ color: colors.accent }}>
              {activeDownloads.length} download{activeDownloads.length === 1 ? '' : 's'} in progress
            </Text>
            <Text variant="caption">Open Downloads to pause, retry or cancel</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={colors.accent} />
        </Pressable>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing.xs,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Text variant="bodyStrong">{category}</Text>
          <Text variant="caption">{items.length}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {(category === 'Downloads' || category === 'Liked') && visibleTracks.length > 0 ? (
            <>
              <TextButton label="Play" onPress={playSelected} />
              <TextButton label="Shuffle" onPress={shuffleSelected} />
              <TextButton
                label={selection.active ? 'Done' : 'Select'}
                onPress={selection.active ? selection.cancel : () => selection.begin()}
              />
            </>
          ) : null}
          {category !== 'Playlists' ? (
            <ToolbarButton
              icon="swap-vertical"
              label="Sort library"
              onPress={() => setSortOpen(true)}
            />
          ) : (
            <ToolbarButton
              icon="swap-vertical"
              label="Sort playlists"
              onPress={() => setSortOpen(true)}
            />
          )}
        </View>
      </View>
    </View>
  );

  const empty = trimmed ? (
    <EmptyState
      icon="search-outline"
      title={`No ${category.toLowerCase()} match “${query.trim()}”`}
      message="Try a different spelling or clear the search to see everything in this section."
      actionLabel="Clear search"
      onAction={() => setQuery('')}
    />
  ) : category === 'Playlists' ? (
    <EmptyState
      icon="list-outline"
      title="No playlists yet"
      message="Create a playlist for a mood, a drive, or the songs you keep coming back to."
      actionLabel="Create playlist"
      onAction={() => navigation.navigate('PlaylistEditor', { mode: 'create' })}
    />
  ) : category === 'Albums' ? (
    <EmptyState
      icon="disc-outline"
      title="No saved albums"
      message="Save albums from their detail page to find them here."
      actionLabel="Explore music"
      onAction={() => navigation.navigate('Main', { screen: 'Search' })}
    />
  ) : category === 'Artists' ? (
    <EmptyState
      icon="people-outline"
      title="No followed artists"
      message="Follow an artist to keep their music close."
      actionLabel="Explore artists"
      onAction={() => navigation.navigate('Main', { screen: 'Search' })}
    />
  ) : category === 'Downloads' ? (
    <EmptyState
      icon="cloud-download-outline"
      title="Nothing downloaded"
      message="Download songs to listen without a connection."
      actionLabel="Find music"
      onAction={() => navigation.navigate('Main', { screen: 'Search' })}
    />
  ) : (
    <EmptyState
      icon="heart-outline"
      title="No liked songs"
      message="Tap the heart on a song and it will appear here."
      actionLabel="Find music"
      onAction={() => navigation.navigate('Main', { screen: 'Search' })}
    />
  );

  return (
    <Screen padded={false}>
      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(item) =>
          item.type === 'playlist'
            ? `playlist-${item.playlist.id}`
            : item.type === 'album'
              ? `album-${item.album.id}`
              : item.type === 'artist'
                ? `artist-${item.artist.id}`
                : `track-${item.track.id}`
        }
        extraData={selection.active ? selection.selectedIds : false}
        ListHeaderComponent={<View style={{ paddingHorizontal: 20 }}>{header}</View>}
        ListEmptyComponent={<View style={{ paddingHorizontal: 20 }}>{empty}</View>}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          if (item.type === 'playlist') {
            return (
              <View style={{ paddingHorizontal: 20 }}>
                <PlaylistRow
                  playlist={item.playlist}
                  onPress={() => openPlaylist(item.playlist)}
                  onMore={() => setPlaylistActions(item.playlist)}
                />
              </View>
            );
          }
          if (item.type === 'album') {
            return (
              <View style={{ paddingHorizontal: 20 }}>
                <SavedMediaRow
                  title={item.album.title}
                  subtitle={`Album · ${item.album.artist.name}`}
                  artworkUri={item.album.artworkUrl}
                  onPress={() =>
                    navigation.navigate('Album', { id: item.album.id, title: item.album.title })
                  }
                  onMore={() => setSavedActions(item)}
                />
              </View>
            );
          }
          if (item.type === 'artist') {
            return (
              <View style={{ paddingHorizontal: 20 }}>
                <SavedMediaRow
                  title={item.artist.name}
                  subtitle="Artist"
                  artworkUri={item.artist.artworkUrl}
                  circular
                  onPress={() =>
                    navigation.navigate('Artist', { id: item.artist.id, name: item.artist.name })
                  }
                  onMore={() => setSavedActions(item)}
                />
              </View>
            );
          }
          return (
            <View style={{ paddingHorizontal: 20 }}>
              <SongRow
                track={item.track}
                downloaded={downloadedIds.has(item.track.id)}
                isCurrent={currentTrack?.id === item.track.id}
                isPlaying={playing}
                selectionMode={selection.active}
                selected={selection.isSelected(item.track.id)}
                onLongPress={() => selection.toggle(item.track.id)}
                onPress={() => {
                  if (selection.active) {
                    selection.toggle(item.track.id);
                    return;
                  }
                  const index = visibleTracks.findIndex((track) => track.id === item.track.id);
                  playTrackList(visibleTracks, index >= 0 ? index : 0);
                }}
                onMore={
                  selection.active
                    ? undefined
                    : () =>
                        openSongMenu(item.track, {
                          sourceLabel: item.source === 'download' ? 'Downloaded' : 'Liked Songs',
                        })
                }
              />
            </View>
          );
        }}
      />

      {selection.active ? (
        <TrackSelectionFooter
          selection={selection}
          tracks={visibleTracks}
          showDownload={category !== 'Downloads'}
          bottomInset={spacing.sm}
        />
      ) : null}

      <BottomSheet visible={sortOpen} onClose={() => setSortOpen(false)} title="Sort by">
        <SheetRow
          icon={sort === 'recent' ? 'checkmark' : 'time-outline'}
          label={
            category === 'Artists'
              ? 'Most played'
              : category === 'Albums'
                ? 'Newest release'
                : category === 'Downloads'
                  ? 'Newest download'
                  : category === 'Liked'
                    ? 'Recently liked'
                    : 'Recently updated'
          }
          onPress={() => {
            setSort('recent');
            setSortOpen(false);
          }}
        />
        <SheetRow
          icon={sort === 'az' ? 'checkmark' : 'text-outline'}
          label="Name (A–Z)"
          onPress={() => {
            setSort('az');
            setSortOpen(false);
          }}
        />
      </BottomSheet>

      <BottomSheet
        visible={playlistActions != null}
        onClose={() => setPlaylistActions(null)}
        title={playlistActions?.name}
        subtitle={`${playlistActions?.tracks.length ?? 0} songs`}
      >
        <SheetRow
          icon="play"
          label="Play"
          onPress={() => {
            if (playlistActions) {
              recordPlaylistPlayed(playlistActions.id);
              playTrackList(playlistActions.tracks);
            }
            setPlaylistActions(null);
          }}
        />
        <SheetRow
          icon="shuffle"
          label="Shuffle"
          onPress={() => {
            if (playlistActions) {
              recordPlaylistPlayed(playlistActions.id);
              playTrackList(playlistActions.tracks, 0, true);
            }
            setPlaylistActions(null);
          }}
        />
        <SheetRow
          icon="download-outline"
          label="Download all"
          onPress={() => {
            if (playlistActions) void downloadPlaylist(playlistActions);
          }}
        />
        <SheetRow
          icon="create-outline"
          label="Edit playlist"
          onPress={() => {
            const playlist = playlistActions;
            setPlaylistActions(null);
            if (playlist)
              navigation.navigate('PlaylistEditor', { playlistId: playlist.id, mode: 'edit' });
          }}
        />
        <SheetRow
          icon="copy-outline"
          label="Duplicate"
          onPress={() => {
            if (playlistActions) {
              const id = duplicatePlaylist(playlistActions.id);
              toast(
                id ? 'Playlist duplicated' : 'Could not duplicate playlist',
                id ? 'success' : 'error'
              );
            }
            setPlaylistActions(null);
          }}
        />
        <SheetRow
          icon="trash-outline"
          label="Delete playlist"
          tone="danger"
          onPress={() => {
            const playlist = playlistActions;
            setPlaylistActions(null);
            setPendingDelete(playlist);
          }}
        />
      </BottomSheet>

      <BottomSheet
        visible={savedActions != null}
        onClose={() => setSavedActions(null)}
        title={
          savedActions?.type === 'album'
            ? savedActions.album.title
            : savedActions?.type === 'artist'
              ? savedActions.artist.name
              : undefined
        }
      >
        <SheetRow
          icon="open-outline"
          label="Open"
          onPress={() => {
            if (savedActions?.type === 'album') {
              navigation.navigate('Album', {
                id: savedActions.album.id,
                title: savedActions.album.title,
              });
            } else if (savedActions?.type === 'artist') {
              navigation.navigate('Artist', {
                id: savedActions.artist.id,
                name: savedActions.artist.name,
              });
            }
            setSavedActions(null);
          }}
        />
        <SheetRow
          icon="heart-dislike-outline"
          label={savedActions?.type === 'album' ? 'Remove saved album' : 'Unfollow artist'}
          tone="danger"
          onPress={() => {
            if (savedActions?.type === 'album') {
              toggleFollowAlbum(savedActions.album);
              toast('Removed album from your library', 'success');
            } else if (savedActions?.type === 'artist') {
              toggleFollowArtist(savedActions.artist);
              toast('Unfollowed artist', 'success');
            }
            setSavedActions(null);
          }}
        />
      </BottomSheet>

      <ConfirmDialog
        visible={pendingDelete != null}
        title="Delete playlist?"
        message={`“${pendingDelete?.name ?? ''}” will be removed from your library. Downloaded audio files stay on this device.`}
        confirmLabel="Delete"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deletePlaylist(pendingDelete.id);
          setPendingDelete(null);
          toast('Playlist deleted', 'success');
        }}
      />
    </Screen>
  );
}

function ToolbarButton({
  icon,
  label,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}
    >
      <Ionicons name={icon} size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

function PlaylistRow({
  playlist,
  onPress,
  onMore,
}: {
  playlist: LocalPlaylist;
  onPress: () => void;
  onMore: () => void;
}) {
  const art = playlist.coverArtworkUrl ?? playlistArtworkUrl(playlist.tracks);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${playlist.name}, ${playlist.tracks.length} songs`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xs,
        opacity: pressed ? 0.68 : 1,
      })}
    >
      <Artwork uri={art} size={58} radius={radii.sm} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyLarge" numberOfLines={1}>
          {playlist.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Text variant="small">{playlist.tracks.length} songs · You</Text>
          {playlist.description ? <Pill label="Notes" /> : null}
        </View>
      </View>
      <Pressable
        onPress={(event) => {
          event.stopPropagation();
          onMore();
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`More options for ${playlist.name}`}
        style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.5 : 1 })}
      >
        <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
      </Pressable>
    </Pressable>
  );
}

function SavedMediaRow({
  title,
  subtitle,
  artworkUri,
  circular,
  onPress,
  onMore,
}: {
  title: string;
  subtitle: string;
  artworkUri?: string | null;
  circular?: boolean;
  onPress: () => void;
  onMore: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xs,
        opacity: pressed ? 0.68 : 1,
      })}
    >
      <Artwork uri={artworkUri} size={58} radius={circular ? 29 : radii.sm} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyLarge" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Pressable
        onPress={(event) => {
          event.stopPropagation();
          onMore();
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`More options for ${title}`}
        style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.5 : 1 })}
      >
        <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
      </Pressable>
    </Pressable>
  );
}
