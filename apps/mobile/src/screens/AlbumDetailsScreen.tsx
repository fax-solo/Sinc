import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeProvider';
import Artwork from '../components/Artwork';
import ActionChip from '../components/ActionChip';
import { DetailSkeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/ScreenState';
import SectionHeader from '../components/SectionHeader';
import TrackRow from '../components/TrackRow';
import { musicApi } from '../api/music';
import { useDetailQuery } from '../hooks/useDetailQuery';
import { usePlaybackStore } from '../state/playbackStore';
import type { SearchTabParamList } from '../navigation/types';

type Route = RouteProp<SearchTabParamList, 'AlbumDetails'>;

export default function AlbumDetailsScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const route = useRoute<Route>();
  const { albumId } = route.params;

  const { state, data, refetch } = useDetailQuery(['album-detail', albumId], () =>
    musicApi.getAlbumDetail(albumId),
  );
  const playTrack = usePlaybackStore((s) => s.playTrack);
  const addToQueue = usePlaybackStore((s) => s.addToQueue);

  if (state === 'loading') {
    return (
      <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
        <DetailSkeleton />
      </View>
    );
  }

  if (state !== 'ready' || !data) {
    return (
      <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
        <ErrorState
          title={
            state === 'offline'
              ? t('detail.offlineTitle')
              : state === 'notFound'
                ? t('detail.notFoundTitle')
                : t('detail.errorTitle')
          }
          body={
            state === 'offline'
              ? t('detail.offlineBody')
              : state === 'notFound'
                ? t('detail.notFoundBody', { type: t('detail.album') })
                : t('detail.errorBody')
          }
          retryLabel={t('common.retry')}
          onRetry={() => void refetch()}
        />
      </View>
    );
  }

  const { album, tracks } = data;

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: tokens.colors.background }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <Artwork label={album.title} size={132} />
        <View style={styles.headerText}>
          <Text
            numberOfLines={2}
            style={[tokens.typography.title2, { color: tokens.colors.onBackground }]}
          >
            {album.title}
          </Text>
          <Text
            numberOfLines={1}
            style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}
          >
            {[
              album.releaseDate?.slice(0, 4),
              album.type,
              tracks.length > 0 ? `${tracks.length} ${t('detail.tracks')}` : undefined,
            ]
              .filter((part): part is string => !!part)
              .join(' · ')}
          </Text>
        </View>
      </View>

      {tracks.length > 0 ? (
        <View style={styles.actions}>
          <ActionChip
            prominent
            label={t('detail.play')}
            onPress={() => tracks[0] && playTrack(tracks[0].id)}
          />
          <ActionChip
            label={t('detail.addAllToQueue')}
            onPress={() => tracks.forEach((track) => addToQueue(track.id))}
          />
          <ActionChip label={t('detail.download')} onPress={() => undefined} disabled />
        </View>
      ) : null}

      {tracks.length === 0 ? (
        <EmptyState title={t('detail.emptyAlbumTitle')} body={t('detail.emptyAlbumBody')} />
      ) : (
        <View style={styles.section}>
          <SectionHeader>{t('detail.tracks')}</SectionHeader>
          {tracks.map((track, index) => (
            <TrackRow
              key={track.id}
              track={track}
              index={index + 1}
              onPress={() => playTrack(track.id)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  header: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
    gap: 6,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  section: {
    marginTop: 8,
  },
});
