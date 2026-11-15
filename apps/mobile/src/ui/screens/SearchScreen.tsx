import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type {
  CanonicalAlbum,
  CanonicalArtist,
  CanonicalPlaylist,
  CanonicalTrack,
} from '@sinc/shared';
import { normalizeText } from '@sinc/shared';
import { Screen, SectionHeader } from '../components/Screen';
import { Text } from '../components/Text';
import { SearchInput, FilterChip } from '../components/Fields';
import { SongRow } from '../components/SongRow';
import { CategoryTile, MediaCard, ArtistCard, SectionRail } from '../components/Cards';
import { EmptyState, ErrorState, ListSkeleton, Pill, SkeletonBlock } from '../components/State';
import { Artwork } from '../components/Artwork';
import { colors, spacing } from '../theme';
import { useSearch } from '../../features/search/useSearch';
import { useSearchStore, MIN_QUERY_CHARS } from '../../features/search/searchStore';
import type { SearchType } from '../../api/music';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { usePlayerStore } from '../../services/player/playerStore';
import { playerService } from '../../services/player/PlayerService';
import { openSongMenu } from '../songMenu/songMenuStore';
import { searchLocalLibrary } from './searchLocal';
import type { MainTabParamList, RootStackParamList } from '../../app/navigation/types';

const FILTERS: Array<{ label: string; value: SearchType }> = [
  { label: 'All', value: 'all' },
  { label: 'Songs', value: 'tracks' },
  { label: 'Artists', value: 'artists' },
  { label: 'Albums', value: 'albums' },
  { label: 'Playlists', value: 'playlists' },
];

const PAGE_SIZE = 8;
const SEARCH_DEBOUNCE_MS = 250;

export function SearchScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<MainTabParamList, 'Search'>>();
  const storedQuery = useSearchStore((state) => state.query);
  const type = useSearchStore((state) => state.type);
  const setType = useSearchStore((state) => state.setType);
  const setQuery = useSearchStore((state) => state.setQuery);
  const submit = useSearchStore((state) => state.submit);
  const recentSearches = useSearchStore((state) => state.recentSearches);
  const removeRecent = useSearchStore((state) => state.removeRecent);
  const clearRecent = useSearchStore((state) => state.clearRecent);

  const [input, setInput] = useState(route.params?.query ?? storedQuery);
  const [visibleTracks, setVisibleTracks] = useState(PAGE_SIZE);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelDebounce = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const triggerImmediateSearch = useCallback(
    (raw: string) => {
      cancelDebounce();
      const trimmed = raw.trim();
      if (!trimmed) return;
      setVisibleTracks(PAGE_SIZE);
      setInput(trimmed);
      submit(trimmed);
    },
    [cancelDebounce, submit]
  );

  const recentlyPlayed = useLibraryStore((state) => state.recentlyPlayed);
  const favorites = useLibraryStore((state) => state.favoriteTracks);
  const followedArtists = useLibraryStore((state) => state.followedArtists);
  const followedAlbums = useLibraryStore((state) => state.followedAlbums);
  const playlists = useLibraryStore((state) => state.playlists);
  const downloads = useDownloadsStore((state) => state.downloads);
  const currentTrack = usePlayerStore((state) => state.queue[state.currentIndex] ?? null);
  const playing = usePlayerStore((state) => state.status === 'playing');

  const downloadedTracks = useMemo(
    () => downloads.filter((record) => record.phase === 'completed').map((record) => record.track),
    [downloads]
  );

  // Debounce what the network sees, but keep the field itself instant.
  useEffect(() => {
    const trimmed = input.trim();
    cancelDebounce();
    if (trimmed === storedQuery) return;
    debounceTimerRef.current = setTimeout(() => {
      setVisibleTracks(PAGE_SIZE);
      setQuery(trimmed);
      debounceTimerRef.current = null;
    }, SEARCH_DEBOUNCE_MS);
    return cancelDebounce;
  }, [input, storedQuery, setQuery, cancelDebounce]);

  useEffect(() => {
    const requested = route.params?.query;
    if (!requested) return;
    // One-shot request from browse/mood tiles.
    cancelDebounce();
    setInput(requested);
    setVisibleTracks(PAGE_SIZE);
    submit(requested);
    // A later manual edit must not be overwritten when the user returns.
    (
      navigation as unknown as {
        setParams: (params: Record<string, unknown>) => void;
      }
    ).setParams({ query: undefined });
  }, [route.params?.query, submit, navigation, cancelDebounce]);

  const suggestions = useMemo(() => {
    const raw = input.trim();
    if (raw.length < 2) return [];
    const norm = normalizeText(raw);
    const seen = new Set<string>();
    const list: Array<{ label: string; kind: 'recent' | 'artist' | 'track' }> = [];

    for (const recent of recentSearches) {
      if (normalizeText(recent).includes(norm) && !seen.has(recent.toLowerCase())) {
        seen.add(recent.toLowerCase());
        list.push({ label: recent, kind: 'recent' });
        if (list.length >= 5) return list;
      }
    }

    for (const artist of followedArtists) {
      if (normalizeText(artist.name).includes(norm) && !seen.has(artist.name.toLowerCase())) {
        seen.add(artist.name.toLowerCase());
        list.push({ label: artist.name, kind: 'artist' });
        if (list.length >= 5) return list;
      }
    }

    for (const track of [...favorites, ...downloadedTracks]) {
      if (normalizeText(track.title).includes(norm) && !seen.has(track.title.toLowerCase())) {
        seen.add(track.title.toLowerCase());
        list.push({ label: track.title, kind: 'track' });
        if (list.length >= 5) return list;
      }
    }

    return list;
  }, [input, recentSearches, followedArtists, favorites, downloadedTracks]);

  const local = useMemo(
    () =>
      searchLocalLibrary({
        query: storedQuery,
        recentlyPlayed,
        favorites,
        downloadedTracks,
        playlists,
        artists: followedArtists,
        albums: followedAlbums,
      }),
    [
      storedQuery,
      recentlyPlayed,
      favorites,
      downloadedTracks,
      playlists,
      followedArtists,
      followedAlbums,
    ]
  );

  const search = useSearch(storedQuery, type);
  const trimmed = storedQuery.trim();
  const ready = trimmed.length >= MIN_QUERY_CHARS;
  const data = search.data;
  const localTrackIds = useMemo(
    () => new Set(local.tracks.map((track) => track.id)),
    [local.tracks]
  );
  const remoteTracks = useMemo(() => {
    if (type !== 'all' && type !== 'tracks') return [];
    return (data?.tracks?.data ?? [])
      .map((row) => row.track)
      .filter((track) => !localTrackIds.has(track.id));
  }, [data, localTrackIds, type]);
  const localTracks = useMemo(
    () => (type === 'all' || type === 'tracks' ? local.tracks : []),
    [type, local.tracks]
  );
  const allTracks = useMemo(() => {
    const seen = new Set<string>();
    const merged: CanonicalTrack[] = [];
    for (const track of [...localTracks, ...remoteTracks]) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      merged.push(track);
    }
    return merged;
  }, [localTracks, remoteTracks]);
  const localPlaylists = type === 'all' || type === 'playlists' ? local.playlists : [];
  const localArtists = type === 'all' || type === 'artists' ? local.artists : [];
  const localAlbums = type === 'all' || type === 'albums' ? local.albums : [];
  const localArtistIds = useMemo(
    () => new Set(local.artists.map((artist) => artist.id)),
    [local.artists]
  );
  const localAlbumIds = useMemo(
    () => new Set(local.albums.map((album) => album.id)),
    [local.albums]
  );
  const localPlaylistIds = useMemo(
    () => new Set(local.playlists.map((playlist) => playlist.id)),
    [local.playlists]
  );
  const remoteArtists =
    type === 'all' || type === 'artists'
      ? (data?.artists?.data ?? []).filter((artist) => !localArtistIds.has(artist.id))
      : [];
  const remoteAlbums =
    type === 'all' || type === 'albums'
      ? (data?.albums?.data ?? []).filter((album) => !localAlbumIds.has(album.id))
      : [];
  const remotePlaylists =
    type === 'all' || type === 'playlists'
      ? (data?.playlists?.data ?? []).filter((playlist) => !localPlaylistIds.has(playlist.id))
      : [];
  const noResults =
    ready &&
    !search.isLoading &&
    allTracks.length === 0 &&
    remoteArtists.length + localArtists.length === 0 &&
    remoteAlbums.length + localAlbums.length === 0 &&
    remotePlaylists.length + localPlaylists.length === 0;

  // Warm the likely first tap while the user reads the result list. Debounced
  // so typing/chip changes cannot storm source resolution; PlayerService also
  // rate-limits per track and the native layer joins in-flight resolves.
  useEffect(() => {
    if (!ready || search.isFetching) return;
    const top = remoteTracks[0];
    if (!top) return;
    const handle = setTimeout(() => playerService.warmUpcoming([top]), 700);
    return () => clearTimeout(handle);
  }, [ready, remoteTracks, search.isFetching]);

  const playTrack = (track: CanonicalTrack) => {
    const index = allTracks.findIndex((item) => item.id === track.id);
    void playerService.playQueue(allTracks, index >= 0 ? index : 0);
  };

  const sourceFor = (track: CanonicalTrack): string => {
    const hasDeezer = Boolean(track.providerIds?.deezer);
    const hasItunes = Boolean(track.providerIds?.itunes);
    const source =
      hasDeezer && hasItunes
        ? 'iTunes & Deezer'
        : hasDeezer
          ? 'Deezer'
          : hasItunes
            ? 'iTunes'
            : 'Sinc';
    return `${track.artists.map((artist) => artist.name).join(', ')} · ${source}`;
  };

  const sourceForPlaylist = (playlist: CanonicalPlaylist): string => {
    if (playlist.providerIds.spotify) return 'Spotify';
    if (playlist.providerIds.deezer) return 'Deezer';
    return 'iTunes';
  };

  const openArtist = (artist: CanonicalArtist) => {
    navigation.navigate('Artist', { id: artist.id, name: artist.name });
  };
  const openAlbum = (album: CanonicalAlbum) => {
    navigation.navigate('Album', { id: album.id, title: album.title });
  };

  return (
    <Screen
      scroll
      padded={false}
      scrollProps={{ keyboardShouldPersistTaps: 'handled', keyboardDismissMode: 'on-drag' }}
    >
      <View style={{ paddingHorizontal: 20 }}>
        <View style={{ paddingTop: spacing.sm, marginBottom: spacing.lg }}>
          <Text variant="display">Search</Text>
          <Text variant="small" style={{ marginTop: 3 }}>
            Songs and playlists from iTunes and Deezer, plus your own library.
          </Text>
        </View>

        <SearchInput
          value={input}
          onChangeText={(value) => {
            setInput(value);
            if (!value.trim()) {
              cancelDebounce();
              setQuery('');
            }
          }}
          onSubmitEditing={() => {
            if (input.trim()) {
              triggerImmediateSearch(input);
            }
            Keyboard.dismiss();
          }}
          onClear={() => {
            cancelDebounce();
            setInput('');
            setVisibleTracks(PAGE_SIZE);
            setQuery('');
          }}
          placeholder="What do you want to listen to?"
        />

        {suggestions.length > 0 && input.trim() !== storedQuery ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              gap: spacing.xs,
              paddingTop: spacing.xs,
              paddingBottom: spacing.xs,
            }}
          >
            {suggestions.map((item) => (
              <Pressable
                key={`${item.kind}-${item.label}`}
                onPress={() => triggerImmediateSearch(item.label)}
                accessibilityRole="button"
                accessibilityLabel={`Search for ${item.label}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: colors.input,
                  borderWidth: 1,
                  borderColor: colors.borderSoft,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 16,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Ionicons
                  name={
                    item.kind === 'recent'
                      ? 'time-outline'
                      : item.kind === 'artist'
                        ? 'person-outline'
                        : 'musical-note-outline'
                  }
                  size={13}
                  color={colors.textSecondary}
                />
                <Text variant="small" numberOfLines={1}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {ready ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.xs, paddingVertical: spacing.md }}
          >
            {FILTERS.map((filter) => (
              <FilterChip
                key={filter.value}
                label={filter.label}
                active={type === filter.value}
                onPress={() => {
                  setType(filter.value);
                  setVisibleTracks(PAGE_SIZE);
                }}
              />
            ))}
          </ScrollView>
        ) : (
          <View style={{ height: spacing.xl }} />
        )}

        {!ready ? (
          <>
            {recentSearches.length > 0 ? (
              <View style={{ marginBottom: spacing.xxl }}>
                <SectionHeader title="Recent searches" actionLabel="Clear" onAction={clearRecent} />
                {recentSearches.map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => {
                      setInput(value);
                      setVisibleTracks(PAGE_SIZE);
                      submit(value);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Search for ${value}`}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm,
                      minHeight: 44,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Ionicons name="time-outline" size={19} color={colors.textMuted} />
                    <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
                      {value}
                    </Text>
                    <Pressable
                      onPress={(event) => {
                        event.stopPropagation();
                        removeRecent(value);
                      }}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${value} from recent searches`}
                    >
                      <Ionicons name="close" size={18} color={colors.textMuted} />
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <SectionHeader title="Browse" subtitle="Pick a lane and start listening" />
            <View style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <CategoryTile
                  title="Made for you"
                  subtitle="Your mixes"
                  colors={['#145A35', '#1ED760']}
                  icon={<Ionicons name="sparkles" size={28} color="rgba(255,255,255,0.6)" />}
                  onPress={() =>
                    navigation.navigate('BrowseCategory', {
                      kind: 'made-for-you',
                      title: 'Made for you',
                    })
                  }
                />
                <CategoryTile
                  title="Charts"
                  subtitle="What’s hot now"
                  colors={['#2A1A55', '#7B5CFF']}
                  icon={<Ionicons name="trending-up" size={28} color="rgba(255,255,255,0.55)" />}
                  onPress={() =>
                    navigation.navigate('BrowseCategory', { kind: 'charts', title: 'Charts' })
                  }
                />
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <CategoryTile
                  title="New releases"
                  subtitle="Fresh albums"
                  colors={['#123C4D', '#26B7D9']}
                  icon={<Ionicons name="albums" size={28} color="rgba(255,255,255,0.55)" />}
                  onPress={() =>
                    navigation.navigate('BrowseCategory', {
                      kind: 'new-releases',
                      title: 'New releases',
                    })
                  }
                />
                <CategoryTile
                  title="Moods"
                  subtitle="Match the moment"
                  colors={['#5A3416', '#F5C451']}
                  icon={<Ionicons name="partly-sunny" size={28} color="rgba(255,255,255,0.55)" />}
                  onPress={() =>
                    navigation.navigate('BrowseCategory', { kind: 'moods', title: 'Moods' })
                  }
                />
              </View>
            </View>

            {local.tracks.length > 0 ? (
              <View style={{ marginBottom: spacing.xl }}>
                <SectionHeader
                  title="From your library"
                  subtitle="Liked, recent and downloaded songs"
                />
                {local.tracks.slice(0, 4).map((track) => (
                  <SongRow
                    key={track.id}
                    track={track}
                    subtitle={`${track.artists.map((artist) => artist.name).join(', ')} · ${
                      local.downloadedIds.has(track.id) ? 'Downloaded' : 'In your library'
                    }`}
                    downloaded={local.downloadedIds.has(track.id)}
                    isCurrent={currentTrack?.id === track.id}
                    isPlaying={playing}
                    onPress={() => playTrack(track)}
                    onMore={() => openSongMenu(track, { sourceLabel: 'From your library' })}
                  />
                ))}
              </View>
            ) : null}
          </>
        ) : null}

        {ready ? (
          <>
            {search.isLoading ? (
              <View style={{ marginTop: spacing.md }}>
                <ListSkeleton rows={6} />
              </View>
            ) : null}

            {search.isError && !data ? (
              <ErrorState
                title="Search failed"
                message={
                  search.error instanceof Error
                    ? search.error.message
                    : 'Check your connection and try again.'
                }
                onRetry={() => void search.refetch()}
              />
            ) : null}

            {noResults && !search.isError ? (
              <EmptyState
                icon="search-outline"
                title={`No results for “${trimmed}”`}
                message="Try a different spelling, a shorter search, or look in your own library instead."
                actionLabel="Clear search"
                onAction={() => {
                  setInput('');
                  setQuery('');
                }}
              />
            ) : null}

            {localTracks.length > 0 ? (
              <View style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.xs,
                    marginBottom: spacing.xs,
                  }}
                >
                  <Text variant="bodyStrong">From your library</Text>
                  <Pill label="Saved" />
                </View>
                {localTracks.slice(0, visibleTracks).map((track) => (
                  <SongRow
                    key={track.id}
                    track={track}
                    subtitle={`${track.artists.map((artist) => artist.name).join(', ')} · ${
                      local.downloadedIds.has(track.id) ? 'Downloaded' : 'In your library'
                    }`}
                    downloaded={local.downloadedIds.has(track.id)}
                    isCurrent={currentTrack?.id === track.id}
                    isPlaying={playing}
                    onPress={() => playTrack(track)}
                    onMore={() => openSongMenu(track, { sourceLabel: 'From your library' })}
                  />
                ))}
                {localTracks.length > visibleTracks ? (
                  <Pressable
                    onPress={() => setVisibleTracks((count) => count + PAGE_SIZE)}
                    accessibilityRole="button"
                    style={{ paddingVertical: spacing.md, alignItems: 'center' }}
                  >
                    <Text variant="small" style={{ color: colors.accent, fontWeight: '700' }}>
                      Show more from your library
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {remoteTracks.length > 0 ? (
              <View style={{ marginBottom: spacing.lg }}>
                <SectionHeader
                  title="Songs"
                  subtitle={type === 'all' ? 'Results from iTunes and Deezer' : undefined}
                />
                {remoteTracks.slice(0, visibleTracks).map((track) => (
                  <SongRow
                    key={track.id}
                    track={track}
                    subtitle={sourceFor(track)}
                    isCurrent={currentTrack?.id === track.id}
                    isPlaying={playing}
                    onPress={() => playTrack(track)}
                    onMore={() => openSongMenu(track, { sourceLabel: 'Search result' })}
                  />
                ))}
                {remoteTracks.length > visibleTracks ? (
                  <Pressable
                    onPress={() => setVisibleTracks((count) => count + PAGE_SIZE)}
                    accessibilityRole="button"
                    style={{ paddingVertical: spacing.md, alignItems: 'center' }}
                  >
                    <Text variant="small" style={{ color: colors.accent, fontWeight: '700' }}>
                      Load more songs
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {localArtists.length + remoteArtists.length > 0 ? (
              <View style={{ marginBottom: spacing.lg }}>
                <SectionHeader title="Artists" />
                <SectionRail>
                  {localArtists.map((artist) => (
                    <View key={`local-${artist.id}`}>
                      <ArtistCard
                        name={artist.name}
                        artworkUri={artist.artworkUrl}
                        onPress={() => openArtist(artist)}
                      />
                    </View>
                  ))}
                  {remoteArtists.map((artist) => (
                    <ArtistCard
                      key={artist.id}
                      name={artist.name}
                      artworkUri={artist.artworkUrl}
                      onPress={() => openArtist(artist)}
                    />
                  ))}
                </SectionRail>
              </View>
            ) : null}

            {localAlbums.length + remoteAlbums.length > 0 ? (
              <View style={{ marginBottom: spacing.lg }}>
                <SectionHeader title="Albums" />
                <SectionRail>
                  {localAlbums.map((album) => (
                    <MediaCard
                      key={`local-${album.id}`}
                      title={album.title}
                      subtitle={album.artist?.name}
                      artworkUri={album.artworkUrl}
                      onPress={() => openAlbum(album)}
                    />
                  ))}
                  {remoteAlbums.map((album) => (
                    <MediaCard
                      key={album.id}
                      title={album.title}
                      subtitle={album.artist?.name}
                      artworkUri={album.artworkUrl}
                      onPress={() => openAlbum(album)}
                    />
                  ))}
                </SectionRail>
              </View>
            ) : null}

            {localPlaylists.length + remotePlaylists.length > 0 ? (
              <View style={{ marginBottom: spacing.lg }}>
                <SectionHeader title="Playlists" subtitle="From iTunes, Deezer and your library" />
                {localPlaylists.map((playlist) => (
                  <Pressable
                    key={playlist.id}
                    onPress={() => navigation.navigate('LocalPlaylist', { id: playlist.id })}
                    accessibilityRole="button"
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm,
                      paddingVertical: 7,
                      opacity: pressed ? 0.65 : 1,
                    })}
                  >
                    <Artwork
                      uri={
                        playlist.coverArtworkUrl ??
                        playlist.tracks.find((track) => track.artworkUrl)?.artworkUrl
                      }
                      size={48}
                      radius={8}
                    />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {playlist.name}
                      </Text>
                      <Text variant="small">{playlist.tracks.length} songs · On this device</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
                  </Pressable>
                ))}
                {remotePlaylists.map((playlist) => (
                  <Pressable
                    key={playlist.id}
                    onPress={() =>
                      navigation.navigate('Playlist', { id: playlist.id, name: playlist.name })
                    }
                    accessibilityRole="button"
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm,
                      paddingVertical: 7,
                      opacity: pressed ? 0.65 : 1,
                    })}
                  >
                    <Artwork uri={playlist.artworkUrl} size={48} radius={8} />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {playlist.name}
                      </Text>
                      <Text variant="small">
                        {playlist.trackCount > 0 ? `${playlist.trackCount} songs` : 'Playlist'} ·{' '}
                        {sourceForPlaylist(playlist)}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {search.isFetching && data ? (
              <View style={{ marginBottom: spacing.lg }}>
                <SkeletonBlock height={12} width="45%" />
              </View>
            ) : null}
          </>
        ) : null}

        <View style={{ height: spacing.xxl }} />
      </View>
    </Screen>
  );
}
