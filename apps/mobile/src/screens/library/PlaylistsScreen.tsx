import React, { useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getDatabase } from '../../db/database';
import { playlistsQuery, removePlaylist, type PlaylistSort } from '../../db/repositories';
import { useQuery } from '../../db/useQuery';
import { useTheme } from '../../theme/ThemeProvider';
import SearchBar from '../../components/SearchBar';
import SortChips from '../../components/SortChips';
import SimpleRow from '../../components/SimpleRow';
import { EmptyState } from '../../components/ScreenState';
import ActionChip from '../../components/ActionChip';

/** Local playlists: list + delete (CRUD creation arrives with M3.2 sync). */
export default function PlaylistsScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PlaylistSort>('name');

  const db = useMemo(() => getDatabase(), []);
  const playlists = useQuery(useMemo(() => playlistsQuery(db, sort, query), [db, sort, query]));

  const confirmRemove = (id: string, name: string): void => {
    Alert.alert(t('library.removePlaylistTitle'), t('library.removePlaylistBody', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => void removePlaylist(db, id),
      },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <SearchBar value={query} onChangeText={setQuery} placeholder={t('library.searchPlaylists')} />
      <SortChips
        options={[
          { value: 'name', label: t('library.sortName') },
          { value: 'recent', label: t('library.sortRecent') },
        ]}
        selected={sort}
        onSelect={setSort}
      />
      <FlatList
        data={playlists}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.rowWrap}>
            <View style={styles.rowMain}>
              <SimpleRow title={item.name} />
            </View>
            <ActionChip
              label={t('common.delete')}
              onPress={() => confirmRemove(item.id, item.name)}
            />
          </View>
        )}
        ListEmptyComponent={
          <EmptyState title={t('library.emptyPlaylists')} body={t('library.emptyPlaylistsBody')} />
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
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowMain: {
    flex: 1,
  },
});
