import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp } from '@react-navigation/native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CanonicalTrack } from '@sinc/shared';
import { AppButton } from '../../components/AppButton';
import { AppText } from '../../components/AppText';
import { ArtistRow } from '../../components/ArtistRow';
import { AlbumRow } from '../../components/AlbumRow';
import { PlaylistRow } from '../../components/PlaylistRow';
import { SongRow } from '../../components/SongRow';
import { useTheme } from '../../theme';
import { playerService } from '../../services/player/PlayerService';
import type { SearchType } from '../../api/music';
import type { MainTabParamList, RootStackParamList } from '../../app/navigation/types';
import { MIN_QUERY_CHARS, useSearchStore } from './searchStore';
import { useSearch } from './useSearch';
import { prefetchArtworks } from '../../api/artwork';

type SearchNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Search'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const TYPE_CHIPS: Array<{ key: SearchType; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'tracks', label: 'Songs' },
  { key: 'artists', label: 'Artists' },
  { key: 'albums', label: 'Albums' },
  { key: 'playlists', label: 'Playlists' },
];

const DEBOUNCE_MS = 250;

export function SearchScreen() {
  const { colors, radii, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<SearchNavigation>();
  const isFocused = useIsFocused();
  const inputRef = useRef<TextInput>(null);

  const query = useSearchStore((s) => s.query);
  const type = useSearchStore((s) => s.type);
  const recentSearches = useSearchStore((s) => s.recentSearches);
  const setQuery = useSearchStore((s) => s.setQuery);
  const setType = useSearchStore((s) => s.setType);
  const submit = useSearchStore((s) => s.submit);
  const removeRecent = useSearchStore((s) => s.removeRecent);
  const clearRecent = useSearchStore((s) => s.clearRecent);

  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const { data, isLoading, isError, refetch } = useSearch(debouncedQuery, type);

  const trimmed = query.trim();
  const hasResults = data !== undefined;
  const tracks = data?.tracks?.data ?? [];
  const artists = data?.artists?.data ?? [];
  const albums = data?.albums?.data ?? [];
  const playlists = data?.playlists?.data ?? [];
  const resultsCount = tracks.length + artists.length + albums.length + playlists.length;

  useEffect(() => {
    if (resultsCount === 0) return;
    prefetchArtworks([
      ...tracks.map((entry) => entry.track.artworkUrl),
      ...artists.map((a) => a.artworkUrl),
      ...albums.map((a) => a.artworkUrl),
    ]);
  }, [resultsCount, tracks, artists, albums]);

  const onSubmit = useCallback(() => {
    if (trimmed.length >= MIN_QUERY_CHARS) {
      submit(trimmed);
      inputRef.current?.blur();
    }
  }, [trimmed, submit]);

  const onRecentPress = useCallback(
    (recent: string) => {
      setQuery(recent);
      submit(recent);
    },
    [setQuery, submit]
  );

  const playTracks = useCallback(
    (list: Array<{ track: CanonicalTrack }>, index: number) => {
      void playerService.playQueue(
        list.map((entry) => entry.track),
        index
      );
      navigation.navigate('Player');
    },
    [navigation]
  );

  const openArtist = useCallback(
    (id: string, name?: string) => navigation.navigate('Artist', { id, name }),
    [navigation]
  );

  const openAlbum = useCallback(
    (id: string, title?: string) => navigation.navigate('Album', { id, title }),
    [navigation]
  );

  const openPlaylist = useCallback(
    (id: string, name?: string) => navigation.navigate('Playlist', { id, name }),
    [navigation]
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={[styles.searchRow, { paddingTop: insets.top + spacing.md }]}>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={onSubmit}
          placeholder="Search songs, albums & artists"
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          autoFocus={isFocused}
          returnKeyType="search"
          style={[
            styles.input,
            {
              backgroundColor: colors.surfaceElevated,
              borderRadius: radii.full,
              color: colors.textPrimary,
            },
          ]}
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} style={styles.clearButton}>
            <AppText color="textSecondary">✕</AppText>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
      >
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md }}>
          {TYPE_CHIPS.map((chip) => {
            const active = type === chip.key;
            return (
              <Pressable
                key={chip.key}
                onPress={() => setType(chip.key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.textPrimary : colors.surfaceElevated,
                    borderRadius: radii.full,
                  },
                ]}
              >
                <AppText
                  variant="small"
                  color={active ? 'onAccent' : 'textSecondary'}
                  style={styles.chipLabel}
                >
                  {chip.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        {!hasResults && trimmed.length < MIN_QUERY_CHARS ? (
          <View>
            {recentSearches.length > 0 ? (
              <View>
                <View style={styles.recentHeader}>
                  <AppText variant="headline">Recent searches</AppText>
                  <Pressable onPress={clearRecent}>
                    <AppText variant="body" color="accent">
                      Clear all
                    </AppText>
                  </Pressable>
                </View>
                {recentSearches.map((recent) => (
                  <Pressable
                    key={recent}
                    onPress={() => onRecentPress(recent)}
                    style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}
                  >
                    <AppText variant="body" style={styles.recentLabel}>
                      {recent}
                    </AppText>
                    <Pressable
                      onPress={() => removeRecent(recent)}
                      hitSlop={8}
                      style={styles.recentRemove}
                    >
                      <AppText color="textMuted">✕</AppText>
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            ) : (
              <AppText variant="body" color="textSecondary" style={styles.hint}>
                Search for songs, albums & artists to get started.
              </AppText>
            )}
          </View>
        ) : null}

        {trimmed.length >= MIN_QUERY_CHARS && isLoading && !hasResults ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />
        ) : null}

        {trimmed.length >= MIN_QUERY_CHARS && isError ? (
          <View style={{ marginTop: spacing.xxl, alignItems: 'center', gap: spacing.md }}>
            <AppText variant="body" color="error" style={{ textAlign: 'center' }}>
              Search failed. Check your connection and try again.
            </AppText>
            <AppButton label="Retry" onPress={() => void refetch()} />
          </View>
        ) : null}

        {hasResults ? (
          resultsCount === 0 ? (
            <AppText variant="body" color="textSecondary" style={styles.hint}>
              No results for "{debouncedQuery}".
            </AppText>
          ) : (
            <View style={{ gap: spacing.xxl }}>
              {tracks.length > 0 ? (
                <View>
                  <AppText variant="headline">Songs</AppText>
                  <FlatList
                    data={tracks}
                    keyExtractor={(item) => item.track.id}
                    scrollEnabled={false}
                    contentContainerStyle={{ marginTop: spacing.sm, gap: spacing.xs }}
                    renderItem={({ item, index }) => (
                      <SongRow
                        track={item.track}
                        showFavorite
                        showAdd
                        showDownload
                        onPress={() => playTracks(tracks, index)}
                      />
                    )}
                  />
                </View>
              ) : null}
              {artists.length > 0 ? (
                <View>
                  <AppText variant="headline">Artists</AppText>
                  <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
                    {artists.map((artist) => (
                      <ArtistRow
                        key={artist.id}
                        artist={artist}
                        onPress={() => openArtist(artist.id, artist.name)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
              {albums.length > 0 ? (
                <View>
                  <AppText variant="headline">Albums</AppText>
                  <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
                    {albums.map((album) => (
                      <AlbumRow
                        key={album.id}
                        album={album}
                        onPress={() => openAlbum(album.id, album.title)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
              {playlists.length > 0 ? (
                <View>
                  <AppText variant="headline">Playlists</AppText>
                  <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
                    {playlists.map((playlist) => (
                      <PlaylistRow
                        key={playlist.id}
                        playlist={playlist}
                        onPress={() => openPlaylist(playlist.id, playlist.name)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          )
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    paddingRight: 40,
  },
  clearButton: {
    position: 'absolute',
    right: 24,
    bottom: 0,
    top: 0,
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  chipLabel: {
    fontWeight: '600',
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  recentLabel: {
    flex: 1,
  },
  recentRemove: {
    padding: 4,
  },
  hint: {
    textAlign: 'center',
    marginTop: 24,
  },
  pressed: {
    opacity: 0.7,
  },
});
