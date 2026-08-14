import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeProvider';
import { DetailSkeleton } from '../components/Skeleton';
import { ErrorState } from '../components/ScreenState';
import { musicApi } from '../api/music';
import { useDetailQuery } from '../hooks/useDetailQuery';
import type { SearchTabParamList } from '../navigation/types';

type Route = RouteProp<SearchTabParamList, 'PlaylistDetails'>;

/**
 * Playlists are intentionally unavailable until M3.2 (playlist backend):
 * the backend always answers 404, so this screen surfaces the honest
 * "not available yet" state with a retry that re-probes the backend.
 */
export default function PlaylistDetailsScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const route = useRoute<Route>();
  const { playlistId } = route.params;

  const { state, refetch } = useDetailQuery(['playlist-detail', playlistId], () =>
    musicApi.getPlaylistDetail(playlistId),
  );

  if (state === 'loading') {
    return (
      <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
        <DetailSkeleton />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <ErrorState
        title={t('detail.playlistsUnavailableTitle')}
        body={t('detail.playlistsUnavailableBody')}
        retryLabel={t('common.retry')}
        onRetry={() => void refetch()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 16,
  },
});
