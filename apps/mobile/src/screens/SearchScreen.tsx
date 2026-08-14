import React, { useCallback, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeProvider';
import AppButton from '../components/AppButton';
import { useSearchStore, SUGGEST_MIN_CHARS } from '../state/searchStore';
import {
  providerIdOf,
  type SearchSuggestion,
  type SearchType,
  type ScoredTrack,
} from '../api/music';
import type { SearchTabParamList } from '../navigation/types';

const TYPES: SearchType[] = ['all', 'songs', 'artists', 'albums', 'playlists'];

export default function SearchScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const query = useSearchStore((s) => s.query);
  const status = useSearchStore((s) => s.status);
  const error = useSearchStore((s) => s.error);
  const results = useSearchStore((s) => s.results);
  const suggestions = useSearchStore((s) => s.suggestions);
  const recentSearches = useSearchStore((s) => s.recentSearches);
  const type = useSearchStore((s) => s.type);
  const hasMore = useSearchStore((s) => s.hasMore);
  const setQuery = useSearchStore((s) => s.setQuery);
  const search = useSearchStore((s) => s.search);
  const setType = useSearchStore((s) => s.setType);
  const loadMore = useSearchStore((s) => s.loadMore);
  const clear = useSearchStore((s) => s.clear);
  const removeRecent = useSearchStore((s) => s.removeRecent);
  const clearRecent = useSearchStore((s) => s.clearRecent);

  const inputRef = useRef<TextInput>(null);
  const [isFocused, setIsFocused] = useState(false);

  const isIdle = status === 'idle';
  const showSuggestions =
    isFocused && query.trim().length >= SUGGEST_MIN_CHARS && suggestions.length > 0;

  const onSubmit = useCallback(() => {
    const q = query.trim();
    if (q) void search(q);
  }, [query, search]);

  const onSuggestionPress = useCallback(
    (suggestion: SearchSuggestion) => {
      inputRef.current?.blur();
      void search(suggestion.text);
    },
    [search],
  );

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <View style={styles.searchBar}>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onSubmitEditing={onSubmit}
          placeholder={t('search.placeholder')}
          placeholderTextColor={tokens.colors.onSurfaceVariant}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={[
            styles.input,
            tokens.typography.body,
            {
              color: tokens.colors.onSurface,
              backgroundColor: tokens.colors.surfaceContainer,
            },
          ]}
        />
        {query.length > 0 ? (
          <TouchableOpacity onPress={clear} style={styles.clearButton} accessibilityRole="button">
            <Text style={[tokens.typography.caption, { color: tokens.colors.primary }]}>
              {t('search.clear')}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <FlatList
        data={[]}
        renderItem={() => null}
        ListHeaderComponent={
          <View style={styles.content}>
            <TypeChips type={type} onChange={setType} />

            {status === 'offline' ? (
              <View style={[styles.stateCard, { backgroundColor: tokens.colors.surfaceContainer }]}>
                <Text style={[tokens.typography.headline, { color: tokens.colors.onSurface }]}>
                  {t('search.offlineTitle')}
                </Text>
                <Text style={[tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}>
                  {t('search.offlineBody')}
                </Text>
                {query.trim() ? <AppButton label={t('common.retry')} onPress={onSubmit} /> : null}
              </View>
            ) : null}

            {status === 'error' ? (
              <View style={[styles.stateCard, { backgroundColor: tokens.colors.surfaceContainer }]}>
                <Text style={[tokens.typography.body, { color: tokens.colors.error }]}>
                  {error ? t(error) : t('search.error')}
                </Text>
                <AppButton label={t('common.retry')} onPress={onSubmit} />
              </View>
            ) : null}

            {status === 'loading' && !results ? (
              <Text style={[tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}>
                {t('common.loading')}
              </Text>
            ) : null}

            {isIdle ? (
              <RecentSearches
                items={recentSearches}
                onSelect={(q) => void search(q)}
                onRemove={removeRecent}
                onClearAll={clearRecent}
              />
            ) : null}

            {showSuggestions ? (
              <Section title={t('search.suggestions')}>
                {suggestions.map((suggestion) => (
                  <SuggestionRow
                    key={`${suggestion.type}:${suggestion.id}`}
                    suggestion={suggestion}
                    onPress={() => onSuggestionPress(suggestion)}
                  />
                ))}
              </Section>
            ) : null}

            {results ? <Results type={type} results={results} hasMore={hasMore} /> : null}
          </View>
        }
        keyboardShouldPersistTaps="handled"
        onEndReached={() => {
          if (hasMore && status === 'success') void loadMore();
        }}
        onEndReachedThreshold={0.4}
      />
    </View>
  );
}

function TypeChips({
  type,
  onChange,
}: {
  type: SearchType;
  onChange: (t: SearchType) => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.chipRow}>
      {TYPES.map((value) => {
        const selected = value === type;
        return (
          <TouchableOpacity
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(value)}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? tokens.colors.primary : tokens.colors.surfaceContainer,
              },
            ]}
          >
            <Text
              style={[
                tokens.typography.caption,
                { color: selected ? tokens.colors.onPrimary : tokens.colors.onSurfaceVariant },
              ]}
            >
              {t(`search.types.${value}`)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function RecentSearches({
  items,
  onSelect,
  onRemove,
  onClearAll,
}: {
  items: string[];
  onSelect: (q: string) => void;
  onRemove: (q: string) => void;
  onClearAll: () => void;
}): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[tokens.typography.headline, { color: tokens.colors.onSurface }]}>
          {t('search.recentSearches')}
        </Text>
        <TouchableOpacity accessibilityRole="button" onPress={onClearAll}>
          <Text style={[tokens.typography.caption, { color: tokens.colors.primary }]}>
            {t('search.clearRecent')}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.chipRow}>
        {items.map((item) => (
          <TouchableOpacity
            key={item}
            accessibilityRole="button"
            onPress={() => onSelect(item)}
            style={[styles.chip, { backgroundColor: tokens.colors.surfaceContainer }]}
          >
            <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
              {item}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`${t('search.clear')} ${item}`}
              onPress={() => onRemove(item)}
              hitSlop={8}
            >
              <Text style={[tokens.typography.caption, { color: tokens.colors.error }]}>×</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function Results({
  type,
  results,
  hasMore,
}: {
  type: SearchType;
  results: NonNullable<ReturnType<typeof useSearchStore.getState>['results']>;
  hasMore: boolean;
}): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const { tracks, artists, albums, playlists } = results;
  const showSongs = type === 'all' || type === 'songs';
  const showArtists = type === 'all' || type === 'artists';
  const showAlbums = type === 'all' || type === 'albums';
  const showPlaylists = type === 'all' || type === 'playlists';

  const isEmpty =
    showSongs &&
    tracks.data.length === 0 &&
    showArtists &&
    artists.data.length === 0 &&
    showAlbums &&
    albums.data.length === 0 &&
    showPlaylists &&
    playlists.data.length === 0;

  if (isEmpty) {
    return (
      <View style={styles.section}>
        <Text style={[tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}>
          {t('search.noResults', { query: useSearchStore.getState().query })}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      {showSongs && tracks.data.length > 0 ? (
        <>
          <SectionTitle>{t('library.tracks')}</SectionTitle>
          {tracks.data.map((entry) => (
            <SongRow key={entry.track.id} entry={entry} />
          ))}
        </>
      ) : null}

      {showArtists && artists.data.length > 0 ? (
        <>
          <SectionTitle>{t('library.artists')}</SectionTitle>
          {artists.data.map((artist) => (
            <ArtistRow
              key={artist.id}
              id={artist.id}
              name={artist.name}
              subtitle={artist.genres.slice(0, 2).join(' · ')}
            />
          ))}
        </>
      ) : null}

      {showAlbums && albums.data.length > 0 ? (
        <>
          <SectionTitle>{t('library.albums')}</SectionTitle>
          {albums.data.map((album) => (
            <AlbumRow
              key={album.id}
              id={album.id}
              title={album.title}
              subtitle={album.releaseYear ? String(album.releaseYear) : undefined}
            />
          ))}
        </>
      ) : null}

      {showPlaylists && playlists.data.length > 0 ? (
        <>
          <SectionTitle>{t('library.playlists')}</SectionTitle>
          {playlists.data.map((playlist, index) => (
            <PlaylistRow
              key={index}
              id={(playlist as { id?: string }).id ?? String(index)}
              name={(playlist as { name?: string }).name ?? t('library.playlists')}
            />
          ))}
        </>
      ) : null}

      {hasMore ? (
        <Text
          style={[
            tokens.typography.caption,
            styles.footer,
            { color: tokens.colors.onSurfaceVariant },
          ]}
        >
          {t('common.loading')}
        </Text>
      ) : null}
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </View>
  );
}

function SectionTitle({ children }: { children: string }): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <Text
      style={[tokens.typography.headline, styles.sectionTitle, { color: tokens.colors.onSurface }]}
    >
      {children}
    </Text>
  );
}

function SongRow({ entry }: { entry: ScoredTrack }): React.JSX.Element {
  const { tokens } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<SearchTabParamList>>();
  const { track } = entry;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={() =>
        navigation.navigate('SongDetails', { trackId: providerIdOf(track.providerIds) ?? track.id })
      }
      style={styles.row}
    >
      <View style={[styles.artwork, { backgroundColor: tokens.colors.surfaceContainerHigh }]}>
        <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
          {(track.album?.title ?? '♪').slice(0, 1)}
        </Text>
      </View>
      <View style={styles.rowText}>
        <Text
          numberOfLines={1}
          style={[tokens.typography.body, { color: tokens.colors.onSurface }]}
        >
          {track.title}
        </Text>
        <Text
          numberOfLines={1}
          style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}
        >
          {track.artists.map((a) => a.name).join(', ')}
          {track.album?.title ? ` · ${track.album.title}` : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function ArtistRow({
  id,
  name,
  subtitle,
}: {
  id: string;
  name: string;
  subtitle?: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<SearchTabParamList>>();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={() => navigation.navigate('ArtistDetails', { artistId: id })}
      style={styles.row}
    >
      <View style={[styles.artwork, { backgroundColor: tokens.colors.primary }]}>
        <Text style={[tokens.typography.caption, { color: tokens.colors.onPrimary }]}>
          {name.slice(0, 1)}
        </Text>
      </View>
      <View style={styles.rowText}>
        <Text
          numberOfLines={1}
          style={[tokens.typography.body, { color: tokens.colors.onSurface }]}
        >
          {name}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function AlbumRow({
  id,
  title,
  subtitle,
}: {
  id: string;
  title: string;
  subtitle?: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<SearchTabParamList>>();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={() => navigation.navigate('AlbumDetails', { albumId: id })}
      style={styles.row}
    >
      <View style={[styles.artwork, { backgroundColor: tokens.colors.surfaceContainerHigh }]}>
        <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
          {title.slice(0, 1)}
        </Text>
      </View>
      <View style={styles.rowText}>
        <Text
          numberOfLines={1}
          style={[tokens.typography.body, { color: tokens.colors.onSurface }]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function PlaylistRow({ id, name }: { id: string; name: string }): React.JSX.Element {
  const { tokens } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<SearchTabParamList>>();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={() => navigation.navigate('PlaylistDetails', { playlistId: id })}
      style={styles.row}
    >
      <View style={[styles.artwork, { backgroundColor: tokens.colors.surfaceContainerHigh }]}>
        <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
          ♫
        </Text>
      </View>
      <View style={styles.rowText}>
        <Text
          numberOfLines={1}
          style={[tokens.typography.body, { color: tokens.colors.onSurface }]}
        >
          {name}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function SuggestionRow({
  suggestion,
  onPress,
}: {
  suggestion: SearchSuggestion;
  onPress: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={styles.row}>
      <View style={[styles.artwork, { backgroundColor: tokens.colors.surfaceContainerHigh }]}>
        <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
          {suggestion.type === 'song' ? '♪' : suggestion.type === 'artist' ? '•' : '◻'}
        </Text>
      </View>
      <View style={styles.rowText}>
        <Text
          numberOfLines={1}
          style={[tokens.typography.body, { color: tokens.colors.onSurface }]}
        >
          {suggestion.text}
        </Text>
        {suggestion.subtitle ? (
          <Text
            numberOfLines={1}
            style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}
          >
            {suggestion.subtitle}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingTop: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  clearButton: {
    paddingHorizontal: 4,
  },
  content: {
    paddingHorizontal: 16,
    gap: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  section: {
    gap: 4,
    paddingBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  sectionTitle: {
    marginTop: 12,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  artwork: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
  stateCard: {
    borderRadius: 12,
    padding: 16,
    gap: 10,
    marginTop: 12,
  },
  footer: {
    textAlign: 'center',
    marginTop: 8,
  },
});
