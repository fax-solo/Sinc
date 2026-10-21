import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp } from '@react-navigation/native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TextInput } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { CanonicalTrack } from '@sinc/shared';
import { v2Colors, v2Spacing } from '../theme';
import { V2Text } from '../components/V2Text';
import { V2Screen } from '../components/V2Screen';
import { V2SearchField, V2Chip } from '../components/V2Fields';
import { V2TrackRow } from '../components/V2TrackRow';
import { V2Artwork } from '../components/V2Artwork';
import { V2Empty, V2Loading } from '../components/V2State';
import { V2Error } from '../components/V2State';
import { playerService } from '../../services/player/PlayerService';
import type { SearchType } from '../../api/music';
import type { MainTabParamList, RootStackParamList } from '../../app/navigation/types';
import { MIN_QUERY_CHARS, useSearchStore } from '../../features/search/searchStore';
import { useSearch } from '../../features/search/useSearch';
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

export function V2SearchScreen() {
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
  const hasLiveQuery = trimmed.length >= MIN_QUERY_CHARS;
  const hasResults = data !== undefined;
  const tracks = useMemo(() => data?.tracks?.data ?? [], [data]);
  const artists = useMemo(() => data?.artists?.data ?? [], [data]);
  const albums = useMemo(() => data?.albums?.data ?? [], [data]);
  const playlists = useMemo(() => data?.playlists?.data ?? [], [data]);
  const resultsCount = tracks.length + artists.length + albums.length + playlists.length;
  // placeholderData keeps the previous key's data alive after the field is
  // cleared, so raw `hasResults` would keep stale results rendered under an
  // empty query. Everything results-related is gated on the live query.
  const showResults = hasLiveQuery && hasResults;

  useEffect(() => {
    if (!hasLiveQuery || resultsCount === 0) return;
    prefetchArtworks([
      ...tracks.map((entry) => entry.track.artworkUrl),
      ...artists.map((a) => a.artworkUrl),
      ...albums.map((a) => a.artworkUrl),
    ]);
  }, [hasLiveQuery, resultsCount, tracks, artists, albums]);

  const onSubmit = useCallback(() => {
    if (trimmed.length >= MIN_QUERY_CHARS) {
      submit(trimmed);
      inputRef.current?.blur();
    }
  }, [trimmed, submit]);

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

  return (
    <V2Screen padded={false} topInset>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ paddingHorizontal: v2Spacing.md, paddingBottom: v2Spacing.sm }}>
          <V2SearchField
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={onSubmit}
            placeholder="Search songs, albums & artists"
            onClear={() => setQuery('')}
            autoFocus={isFocused}
          />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: v2Spacing.md, paddingBottom: v2Spacing.xxxl }}
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: v2Spacing.xs, paddingVertical: v2Spacing.sm }}
          >
            {TYPE_CHIPS.map((chip) => (
              <V2Chip
                key={chip.key}
                label={chip.label}
                active={type === chip.key}
                onPress={() => setType(chip.key)}
              />
            ))}
          </ScrollView>

          {!showResults && !hasLiveQuery ? (
            recentSearches.length > 0 ? (
              <View>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: v2Spacing.xs,
                  }}
                >
                  <V2Text variant="headline">Recent searches</V2Text>
                  <Pressable onPress={clearRecent} hitSlop={8}>
                    <V2Text variant="small" color="accent" style={{ fontWeight: '700' }}>
                      Clear all
                    </V2Text>
                  </Pressable>
                </View>
                {recentSearches.map((recent) => (
                  // Sibling pressables, not nested: removing must not submit.
                  <View
                    key={recent}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: v2Spacing.sm,
                      paddingVertical: v2Spacing.sm,
                    }}
                  >
                    <Pressable
                      onPress={() => {
                        setQuery(recent);
                        submit(recent);
                      }}
                      style={({ pressed }) => ({
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: v2Spacing.sm,
                        opacity: pressed ? 0.6 : 1,
                      })}
                      accessibilityRole="button"
                      accessibilityLabel={`Search ${recent}`}
                    >
                      <Ionicons name="time-outline" size={18} color={v2Colors.textMuted} />
                      <V2Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
                        {recent}
                      </V2Text>
                    </Pressable>
                    <Pressable
                      onPress={() => removeRecent(recent)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${recent}`}
                    >
                      <Ionicons name="close" size={18} color={v2Colors.textMuted} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <V2Empty
                icon="search"
                title="Search Sinc"
                hint="Find songs, artists, albums and playlists to play or save offline."
              />
            )
          ) : null}

          {hasLiveQuery && isLoading && !showResults ? <V2Loading label="Searching…" /> : null}

          {hasLiveQuery && isError ? (
            <V2Error
              message="Search failed. Check your connection and try again."
              onRetry={() => void refetch()}
            />
          ) : null}

          {showResults ? (
            resultsCount === 0 ? (
              <V2Empty
                icon="search-outline"
                title={`No results for "${debouncedQuery}"`}
                hint="Check the spelling or try a different search."
              />
            ) : (
              <View style={{ gap: v2Spacing.xl }}>
                {tracks.length > 0 ? (
                  <View>
                    <V2Text variant="headline" style={{ marginBottom: v2Spacing.xs }}>
                      Songs
                    </V2Text>
                    {/* Plain map instead of a nested FlatList: a vertical
                        VirtualizedList with scrollEnabled={false} inside a
                        ScrollView stops advancing its render window past the
                        initial rows — search results beyond ~10 songs were
                        rendered but unreachable. */}
                    {tracks.map((item, index) => (
                      <V2TrackRow
                        key={item.track.id}
                        track={item.track}
                        showFavorite
                        showAdd
                        showDownload
                        onPress={() => playTracks(tracks, index)}
                      />
                    ))}
                  </View>
                ) : null}
                {artists.length > 0 ? (
                  <View>
                    <V2Text variant="headline" style={{ marginBottom: v2Spacing.xs }}>
                      Artists
                    </V2Text>
                    {artists.map((artist) => (
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
                ) : null}
                {albums.length > 0 ? (
                  <View>
                    <V2Text variant="headline" style={{ marginBottom: v2Spacing.xs }}>
                      Albums
                    </V2Text>
                    {albums.map((album) => (
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
                ) : null}
                {playlists.length > 0 ? (
                  <View>
                    <V2Text variant="headline" style={{ marginBottom: v2Spacing.xs }}>
                      Playlists
                    </V2Text>
                    {playlists.map((playlist) => (
                      <Pressable
                        key={playlist.id}
                        onPress={() =>
                          navigation.navigate('Playlist', { id: playlist.id, name: playlist.name })
                        }
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: v2Spacing.sm,
                          paddingVertical: v2Spacing.xs,
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <V2Artwork uri={playlist.artworkUrl} size={52} />
                        <View style={{ flex: 1 }}>
                          <V2Text variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>
                            {playlist.name}
                          </V2Text>
                          <V2Text variant="small" color="textSecondary" numberOfLines={1}>
                            {playlist.trackCount} songs
                          </V2Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            )
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </V2Screen>
  );
}
