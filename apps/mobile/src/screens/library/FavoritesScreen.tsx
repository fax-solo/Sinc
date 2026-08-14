import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getDatabase } from '../../db/database';
import { favoritesQuery } from '../../db/repositories';
import { useQuery } from '../../db/useQuery';
import { useTheme } from '../../theme/ThemeProvider';
import SortChips from '../../components/SortChips';
import SimpleRow from '../../components/SimpleRow';
import { EmptyState } from '../../components/ScreenState';
import type { FavoriteTarget } from '../../db/schema';
import type { Album, Artist, Track } from '../../db/models';
import type { LibraryTabParamList } from '../../navigation/types';

const ALL_TARGETS = '__all__' as const;
type Filter = FavoriteTarget | typeof ALL_TARGETS;

/** Favorited tracks/artists/albums with a type filter. */
export default function FavoritesScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<LibraryTabParamList>>();
  const [filter, setFilter] = useState<Filter>(ALL_TARGETS);

  const db = useMemo(() => getDatabase(), []);
  const favorites = useQuery(
    useMemo(() => favoritesQuery(db, filter === ALL_TARGETS ? undefined : filter), [db, filter]),
  );

  const openFavorite = (targetType: FavoriteTarget, targetId: string): void => {
    void (async () => {
      const dbRef = getDatabase();
      if (targetType === 'track') {
        const track = await dbRef.collections
          .get<Track>('tracks')
          .find(targetId)
          .catch(() => null);
        if (track?.providerId) navigation.navigate('SongDetails', { trackId: track.providerId });
        return;
      }
      if (targetType === 'artist') {
        const artist = await dbRef.collections
          .get<Artist>('artists')
          .find(targetId)
          .catch(() => null);
        if (artist?.providerId)
          navigation.navigate('ArtistDetails', { artistId: artist.providerId });
        return;
      }
      const album = await dbRef.collections
        .get<Album>('albums')
        .find(targetId)
        .catch(() => null);
      if (album?.providerId) navigation.navigate('AlbumDetails', { albumId: album.providerId });
    })();
  };

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <SortChips
        options={[
          { value: ALL_TARGETS, label: t('library.favAll') },
          { value: 'track', label: t('library.tracks') },
          { value: 'artist', label: t('library.artists') },
          { value: 'album', label: t('library.albums') },
        ]}
        selected={filter}
        onSelect={setFilter}
      />
      <FlatList
        data={favorites}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SimpleRow
            title={item.title ?? item.targetId}
            subtitle={item.subtitle ?? undefined}
            monogram={item.targetType.slice(0, 1).toUpperCase()}
            onPress={() => openFavorite(item.targetType, item.targetId)}
          />
        )}
        ListEmptyComponent={
          <EmptyState title={t('library.emptyFavorites')} body={t('library.emptyFavoritesBody')} />
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
