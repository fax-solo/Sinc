import { useEffect, useMemo, useState } from 'react';
import { FlatList, Keyboard, Pressable, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import type { CanonicalTrack } from '@sinc/shared';
import { Text } from '../components/Text';
import { SearchInput } from '../components/Fields';
import { IconButton } from '../components/Buttons';
import { SongRow } from '../components/SongRow';
import { toast } from '../components/Overlays';
import { EmptyState, ErrorState, ListSkeleton } from '../components/State';
import { colors, radii, spacing } from '../theme';
import { musicApi } from '../../api/music';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { searchLocalLibrary } from './searchLocal';
import type { RootStackParamList } from '../../app/navigation/types';

const MIN_QUERY = 2;
const MAX_SUGGESTIONS = 30;

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

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 320);
    return () => clearTimeout(timer);
  }, [input]);

  const downloadedTracks = useMemo(
    () =>
      downloads
        .filter((record) => record.phase === 'completed' && record.localUri)
        .map((record) => record.track),
    [downloads]
  );

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const result: CanonicalTrack[] = [];
    for (const track of [...recentlyPlayed, ...favorites, ...downloadedTracks]) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      result.push(track);
      if (result.length >= MAX_SUGGESTIONS) break;
    }
    return result;
  }, [recentlyPlayed, favorites, downloadedTracks]);

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
    if (query.length < MIN_QUERY) return suggestions;
    const seen = new Set<string>();
    const merged: CanonicalTrack[] = [];
    const remoteTracks = remote.data?.tracks?.data.map((row) => row.track) ?? [];
    for (const track of [...local.tracks, ...remoteTracks]) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      merged.push(track);
    }
    return merged;
  }, [query, suggestions, local.tracks, remote.data]);

  const existingIds = useMemo(
    () => new Set(playlist?.tracks.map((track) => track.id) ?? []),
    [playlist]
  );
  const downloadedIds = useMemo(
    () => new Set(downloadedTracks.map((track) => track.id)),
    [downloadedTracks]
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

  const addAll = () => {
    const candidates = results.filter((track) => !existingIds.has(track.id));
    if (candidates.length === 0) {
      toast('Every result is already in this playlist', 'default');
      return;
    }
    const added = addTracksToPlaylist(playlist.id, candidates);
    toast(
      added > 0
        ? `Added ${added} song${added === 1 ? '' : 's'}`
        : 'No new songs to add',
      added > 0 ? 'success' : 'default'
    );
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
        onChangeText={setInput}
        placeholder="Search songs to add"
        onClear={() => setInput('')}
        returnKeyType="search"
        onSubmitEditing={() => {
          setQuery(input.trim());
          Keyboard.dismiss();
        }}
      />

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
          {query.length >= MIN_QUERY ? 'SEARCH RESULTS' : 'FROM YOUR LIBRARY'}
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentContainerStyle={{
          paddingTop: insets.top + spacing.xs,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          query.length >= MIN_QUERY && !remote.isFetching && !remote.isError ? (
            <EmptyState
              icon="search-outline"
              title="No songs found"
              message="Try a different title or artist."
            />
          ) : query.length < MIN_QUERY && suggestions.length === 0 ? (
            <EmptyState
              icon="musical-notes-outline"
              title="Search the catalog"
              message="Type a song or artist name. Songs you like, play or download appear here for quick access."
            />
          ) : null
        }
        renderItem={({ item }) => {
          const added = existingIds.has(item.id);
          return (
            <SongRow
              track={item}
              downloaded={downloadedIds.has(item.id)}
              onPress={() => add(item)}
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
    </View>
  );
}
