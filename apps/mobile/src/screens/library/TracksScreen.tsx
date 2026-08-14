import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CanonicalTrack } from '@sinc/shared';
import { getDatabase } from '../../db/database';
import { tracksQuery, type TrackSort } from '../../db/repositories';
import { useQuery } from '../../db/useQuery';
import { resolveArtistNames, toCanonicalTrack } from '../../db/adapters';
import { useTheme } from '../../theme/ThemeProvider';
import SearchBar from '../../components/SearchBar';
import SortChips from '../../components/SortChips';
import TrackRow from '../../components/TrackRow';
import { EmptyState } from '../../components/ScreenState';
import type { LibraryTabParamList } from '../../navigation/types';

/** Local library tracks with search + sorting. */
export default function TracksScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<LibraryTabParamList>>();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<TrackSort>('title');

  const db = useMemo(() => getDatabase(), []);
  const tracks = useQuery(useMemo(() => tracksQuery(db, sort, query), [db, sort, query]));
  const [items, setItems] = useState<CanonicalTrack[]>([]);

  useEffect(() => {
    let mounted = true;
    void resolveArtistNames(tracks).then((names) => {
      if (!mounted) return;
      setItems(tracks.map((track) => toCanonicalTrack(track, names.get(track.id))));
    });
    return () => {
      mounted = false;
    };
  }, [tracks]);

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <SearchBar value={query} onChangeText={setQuery} placeholder={t('library.searchTracks')} />
      <SortChips
        options={[
          { value: 'title', label: t('library.sortTitle') },
          { value: 'artist', label: t('library.sortArtist') },
          { value: 'recent', label: t('library.sortRecent') },
        ]}
        selected={sort}
        onSelect={setSort}
      />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const mbId = item.providerIds.musicbrainz;
          return (
            <TrackRow
              track={item}
              onPress={
                mbId ? () => navigation.navigate('SongDetails', { trackId: mbId }) : undefined
              }
            />
          );
        }}
        ListEmptyComponent={
          <EmptyState title={t('library.emptyTracks')} body={t('library.emptyTracksBody')} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
});
