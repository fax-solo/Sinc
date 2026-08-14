import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getDatabase } from '../../db/database';
import { artistsQuery, type ArtistSort } from '../../db/repositories';
import { useQuery } from '../../db/useQuery';
import { useTheme } from '../../theme/ThemeProvider';
import SearchBar from '../../components/SearchBar';
import SortChips from '../../components/SortChips';
import SimpleRow from '../../components/SimpleRow';
import { EmptyState } from '../../components/ScreenState';
import type { LibraryTabParamList } from '../../navigation/types';

/** Local library artists with search + sorting. */
export default function ArtistsScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<LibraryTabParamList>>();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ArtistSort>('name');

  const db = useMemo(() => getDatabase(), []);
  const artists = useQuery(useMemo(() => artistsQuery(db, sort, query), [db, sort, query]));

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <SearchBar value={query} onChangeText={setQuery} placeholder={t('library.searchArtists')} />
      <SortChips
        options={[
          { value: 'name', label: t('library.sortName') },
          { value: 'recent', label: t('library.sortRecent') },
        ]}
        selected={sort}
        onSelect={setSort}
      />
      <FlatList
        data={artists}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SimpleRow
            title={item.name}
            onPress={
              item.providerId
                ? () => navigation.navigate('ArtistDetails', { artistId: item.providerId! })
                : undefined
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState title={t('library.emptyArtists')} body={t('library.emptyArtistsBody')} />
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
