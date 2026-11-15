import { useEffect, useMemo, useState } from 'react';
import { FlatList, Keyboard, Pressable, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import type { CanonicalTrack } from '@sinc/shared';
import { Text } from '../components/Text';
import { FilterChip, SearchInput } from '../components/Fields';
import { IconButton, PrimaryButton } from '../components/Buttons';
import { SongRow } from '../components/SongRow';
import { ConfirmDialog, toast } from '../components/Overlays';
import { EmptyState, ErrorState, ListSkeleton } from '../components/State';
import { colors, radii, spacing } from '../theme';
import { musicApi } from '../../api/music';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { searchLocalLibrary } from './searchLocal';
import {
  addSongsSourceLabel,
  completedDownloadTracks,
  tracksForAddSongsSource,
  type AddSongsSource,
} from './addSongsLibrary';
import { TrackSelectionBar } from '../selection/TrackSelectionBar';
import { useTrackSelection } from '../selection/useTrackSelection';
import type { RootStackParamList } from '../../app/navigation/types';

const MIN_QUERY = 2;
const LARGE_BATCH = 25;

const SOURCES: Array<{ key: AddSongsSource; label: string }> = [
  { key: 'downloaded', label: 'Downloaded' },
  { key: 'liked', label: 'Liked' },
  { key: 'recent', label: 'Recent' },
];

export function AddSongsScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'AddSongs'>) {
  const insets = useSafeAreaInsets();
  const playlist = useLibraryStore((state) =>
    state.playlists.find((item) => item.id === route.params.playlistId)
  );
  const addToPlaylist = useLibraryStore((state) => state.addToPlaylist);
  const addTracksToPlaylist = useLibraryStore((state) => state.addTracksToPlaylist);
  const favorites = useLibraryStore((state) => state.favoriteTracks);
  const recentlyPlayed = useLibraryStore((state) => state.recentlyPlayed);
  const playlists = useLibraryStore((state) => state.playlists);
  const followedArtists = useLibraryStore((state) => state.followedArtists);
  const followedAlbums = useLibraryStore((state) => state.followedAlbums);
  const downloads = useDownloadsStore((state) => state.downloads);

  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<AddSongsSource>('downloaded');
  const [pendingAddAll, setPendingAddAll] = useState<CanonicalTrack[] | null>(null);
  const selection = useTrackSelection();
  const cancelSelection = selection.cancel;

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 320);
    return () => clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    // Changing the visible library subset must not leave hidden songs selected.
    cancelSelection();
  }, [query, source, cancelSelection]);

  const downloadedTracks = useMemo(() => completedDownloadTracks(downloads), [downloads]);

  const sourceTracks = useMemo(
    () =>
      tracksForAddSongsSource(source, {
        downloads,
        favorites,
        recentlyPlayed,
      }),
    [source, downloads, favorites, recentlyPlayed]
  );

  const local = useMemo(
    () =>
      searchLocalLibrary({
        query,
        recentlyPlayed,
        favorites,
        downloadedTracks,
        playlists,
        artists: followedArtists,
        albums: followedAlbums,
        trackLimit: Number.POSITIVE_INFINITY,
      }),
    [query, recentlyPlayed, favorites, downloadedTracks, playlists, followedArtists, followedAlbums]
  );

  const remote = useQuery({
    queryKey: ['add-songs-search', query],
    queryFn: () => musicApi.search(query, 'tracks'),
    enabled: query.length >= MIN_QUERY,
    retry: 1,
  });

  const results = useMemo(() => {
    if (query.length < MIN_QUERY) return sourceTracks;
    const seen = new Set<string>();
    const merged: CanonicalTrack[] = [];
    const remoteTracks = remote.data?.tracks?.data.map((row) => row.track) ?? [];
    for (const track of [...local.tracks, ...remoteTracks]) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      merged.push(track);
    }
    return merged;
  }, [query, sourceTracks, local.tracks, remote.data]);

  const existingIds = useMemo(
    () => new Set(playlist?.tracks.map((track) => track.id) ?? []),
    [playlist]
  );
  const downloadedIds = useMemo(
    () => new Set(downloadedTracks.map((track) => track.id)),
    [downloadedTracks]
  );
  const addableIds = useMemo(
    () => results.filter((track) => !existingIds.has(track.id)).map((track) => track.id),
    [results, existingIds]
  );
  const selectedTracks = useMemo(
    () =>
      results.filter((track) => selection.selectedIds.has(track.id) && !existingIds.has(track.id)),
    [results, selection.selectedIds, existingIds]
  );

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

  const add = (track: CanonicalTrack) => {
    if (existingIds.has(track.id)) {
      toast('Already in this playlist', 'default');
      return;
    }
    addToPlaylist(playlist.id, track);
    toast('Added to playlist', 'success');
  };

  const addCandidates = (candidates: CanonicalTrack[]) => {
    const added = addTracksToPlaylist(playlist.id, candidates);
    toast(
      added > 0 ? `Added ${added} song${added === 1 ? '' : 's'}` : 'No new songs to add',
      added > 0 ? 'success' : 'default'
    );
    if (added > 0) selection.cancel();
  };

  const addAll = () => {
    const candidates = results.filter((track) => !existingIds.has(track.id));
    if (candidates.length === 0) {
      toast('Every result is already in this playlist', 'default');
      return;
    }
    if (candidates.length > LARGE_BATCH) {
      setPendingAddAll(candidates);
      return;
    }
    addCandidates(candidates);
  };

  const addSelected = () => {
    if (selectedTracks.length === 0) return;
    addCandidates(selectedTracks);
  };

  const header = (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingTop: spacing.xs,
          marginBottom: spacing.md,
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
          <Text variant="headline">Add songs</Text>
          <Text variant="caption" numberOfLines={1}>
            {playlist.name} · {playlist.tracks.length} songs
          </Text>
        </View>
        <Pressable
          onPress={addAll}
          accessibilityRole="button"
          accessibilityLabel="Add all search results"
          style={({ pressed }) => ({
            minHeight: 36,
            paddingHorizontal: spacing.md,
            borderRadius: radii.full,
            backgroundColor: results.length > 0 ? colors.accentSoft : colors.card,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: results.length === 0 ? 0.4 : pressed ? 0.7 : 1,
          })}
        >
          <Text
            variant="small"
            style={{
              color: results.length > 0 ? colors.accent : colors.textMuted,
              fontWeight: '700',
            }}
          >
            Add all
          </Text>
        </Pressable>
      </View>

      <SearchInput
        value={input}
        onChangeText={(value) => {
          setInput(value);
          setPendingAddAll(null);
        }}
        placeholder="Search songs to add"
        onClear={() => {
          setInput('');
          setPendingAddAll(null);
        }}
        returnKeyType="search"
        onSubmitEditing={() => {
          setPendingAddAll(null);
          setQuery(input.trim());
          Keyboard.dismiss();
        }}
      />

      {query.length < MIN_QUERY ? (
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md }}>
          {SOURCES.map((item) => (
            <FilterChip
              key={item.key}
              label={item.label}
              count={
                item.key === 'downloaded'
                  ? downloadedTracks.length
                  : item.key === 'liked'
                    ? favorites.length
                    : recentlyPlayed.length
              }
              active={source === item.key}
              onPress={() => {
                setPendingAddAll(null);
                setSource(item.key);
              }}
            />
          ))}
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: spacing.lg,
          marginBottom: spacing.xs,
        }}
      >
        <Text variant="micro">
          {query.length >= MIN_QUERY ? 'SEARCH RESULTS' : addSongsSourceLabel(source)}
        </Text>
        <Text variant="caption">
          {results.length} song{results.length === 1 ? '' : 's'}
        </Text>
      </View>

      {query.length >= MIN_QUERY && remote.isFetching && results.length === 0 ? (
        <ListSkeleton rows={5} />
      ) : null}

      {query.length >= MIN_QUERY && remote.isError && results.length === 0 ? (
        <ErrorState
          compact
          title="Search failed"
          message="Check your connection and try again."
          onRetry={() => void remote.refetch()}
        />
      ) : null}
    </View>
  );

  const emptyTitle =
    source === 'downloaded'
      ? 'No downloaded songs'
      : source === 'liked'
        ? 'No liked songs'
        : 'Nothing played yet';
  const emptyMessage =
    source === 'downloaded'
      ? 'Download songs from Search, an album or a playlist and they will all show up here.'
      : source === 'liked'
        ? 'Tap the heart on a song and it will appear here.'
        : 'Songs you play will show up here for quick access.';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        style={{ flex: 1 }}
        data={results}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentContainerStyle={{
          paddingTop: insets.top + spacing.xs,
          paddingHorizontal: 20,
          paddingBottom: spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        extraData={selection.active ? selection.selectedIds : false}
        ListEmptyComponent={
          query.length >= MIN_QUERY && !remote.isFetching && !remote.isError ? (
            <EmptyState
              icon="search-outline"
              title="No songs found"
              message="Try a different title or artist."
            />
          ) : query.length < MIN_QUERY ? (
            <EmptyState icon="musical-notes-outline" title={emptyTitle} message={emptyMessage} />
          ) : null
        }
        renderItem={({ item }) => {
          const added = existingIds.has(item.id);
          const selected = selection.isSelected(item.id);
          return (
            <SongRow
              track={item}
              downloaded={downloadedIds.has(item.id)}
              selectionMode={selection.active}
              selected={selected}
              onLongPress={() => {
                if (added) {
                  toast('Already in this playlist', 'default');
                  return;
                }
                selection.toggle(item.id);
              }}
              onPress={() => {
                if (selection.active) {
                  if (added) {
                    toast('Already in this playlist', 'default');
                    return;
                  }
                  selection.toggle(item.id);
                  return;
                }
                add(item);
              }}
              trailing={
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: added ? colors.accentSoft : colors.card,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name={added ? 'checkmark' : 'add'}
                    size={19}
                    color={added ? colors.accent : colors.text}
                  />
                </View>
              }
            />
          );
        }}
      />

      {selection.active ? (
        <TrackSelectionBar
          count={selectedTracks.length}
          totalCount={addableIds.length}
          allSelected={addableIds.length > 0 && selectedTracks.length === addableIds.length}
          onCancel={selection.cancel}
          onSelectAll={() => selection.selectAll(addableIds)}
          onDeselectAll={selection.deselectAll}
        >
          <PrimaryButton
            compact
            label={
              selectedTracks.length > 0
                ? `Add ${selectedTracks.length} song${selectedTracks.length === 1 ? '' : 's'}`
                : 'Add selected'
            }
            disabled={selectedTracks.length === 0}
            onPress={addSelected}
            style={{ flex: 1 }}
          />
        </TrackSelectionBar>
      ) : null}

      <ConfirmDialog
        visible={pendingAddAll != null}
        title="Add all songs?"
        message={`Add ${pendingAddAll?.length ?? 0} songs to “${playlist.name}”?`}
        confirmLabel="Add all"
        onCancel={() => setPendingAddAll(null)}
        onConfirm={() => {
          const candidates = pendingAddAll;
          setPendingAddAll(null);
          if (candidates) addCandidates(candidates);
        }}
      />
    </View>
  );
}
