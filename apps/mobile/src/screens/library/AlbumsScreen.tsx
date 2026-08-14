import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getDatabase } from '../../db/database';
import { albumsQuery, type AlbumSort } from '../../db/repositories';
import { useQuery } from '../../db/useQuery';
import { useTheme } from '../../theme/ThemeProvider';
import SearchBar from '../../components/SearchBar';
import SortChips from '../../components/SortChips';
import SimpleRow from '../../components/SimpleRow';
import { EmptyState } from '../../components/ScreenState';
import type { LibraryTabParamList } from '../../navigation/types';

interface AlbumRow {
  id: string;
  title: string;
  providerId: string | null;
  artistName: string;
}

/** Local library albums with search + sorting. */
export default function AlbumsScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<LibraryTabParamList>>();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<AlbumSort>('title');

  const db = useMemo(() => getDatabase(), []);
  const albums = useQuery(useMemo(() => albumsQuery(db, sort, query), [db, sort, query]));
  const [rows, setRows] = useState<AlbumRow[]>([]);

  useEffect(() => {
    let mounted = true;
    void Promise.all(
      albums.map(async (album) => ({
        id: album.id,
        title: album.title,
        providerId: album.providerId,
        artistName: album.artistId ? (await album.artist.fetch()).name : '',
      })),
    ).then((found) => {
      if (mounted) setRows(found);
    });
    return () => {
      mounted = false;
    };
  }, [albums]);

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <SearchBar value={query} onChangeText={setQuery} placeholder={t('library.searchAlbums')} />
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
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SimpleRow
            title={item.title}
            subtitle={item.artistName}
            onPress={
              item.providerId
                ? () => navigation.navigate('AlbumDetails', { albumId: item.providerId! })
                : undefined
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState title={t('library.emptyAlbums')} body={t('library.emptyAlbumsBody')} />
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
