import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Share, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRoute, type RouteProp } from '@react-navigation/native';
import type { Observable } from 'rxjs';
import { useTheme } from '../theme/ThemeProvider';
import Artwork from '../components/Artwork';
import ActionChip from '../components/ActionChip';
import { DetailSkeleton } from '../components/Skeleton';
import { ErrorState } from '../components/ScreenState';
import { musicApi } from '../api/music';
import { useDetailQuery } from '../hooks/useDetailQuery';
import { usePlaybackStore } from '../state/playbackStore';
import { getDatabase } from '../db/database';
import type { Download } from '../db/models';
import { downloadService } from '../downloads/instance';
import type { SearchTabParamList } from '../navigation/types';

type Route = RouteProp<SearchTabParamList, 'SongDetails'>;

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function SongDetailsScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const route = useRoute<Route>();
  const { trackId } = route.params;

  const { state, data, refetch } = useDetailQuery(['track-detail', trackId], () =>
    musicApi.getTrackDetail(trackId),
  );
  const playTrack = usePlaybackStore((s) => s.playTrack);
  const addToQueue = usePlaybackStore((s) => s.addToQueue);

  const db = useMemo(() => getDatabase(), []);
  const [jobStatus, setJobStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!trackId) return;
    let mounted = true;
    const collection = db.collections.get('downloads');
    const observable = collection.findAndObserve(trackId) as Observable<Download>;
    const subscription = observable.subscribe({
      next: (row) => {
        if (mounted) setJobStatus(row.status);
      },
      error: () => {
        if (mounted) setJobStatus(null);
      },
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [db, trackId]);

  const onDownload = useCallback(() => {
    const track = data?.track;
    if (!track) return;
    void downloadService
      .enqueueDownload(db, {
        trackId: track.id,
        title: track.title,
        artist: track.artists.map((a) => a.name).join(', '),
        artworkUrl: track.artworkUrl,
      })
      .then((result) => {
        if (result.ok) return;
        if (result.reason === 'low-storage') {
          Alert.alert(t('downloads.lowStorage'));
        } else if (result.reason !== 'already-downloading') {
          Alert.alert(
            t('detail.errorTitle'),
            result.reason === 'failed' ? result.message : undefined,
          );
        }
      });
  }, [data, db, t]);

  const onRemoveDownload = useCallback(() => {
    void downloadService.deleteDownload(db, trackId);
  }, [db, trackId]);

  const downloadLabel = useCallback(() => {
    switch (jobStatus) {
      case 'COMPLETED':
        return t('detail.downloaded');
      case 'DOWNLOADING':
      case 'QUEUED':
      case 'RESOLVING':
        return t('detail.downloadingLabel');
      default:
        return t('detail.download');
    }
  }, [jobStatus, t]);

  const onShare = useCallback(() => {
    const track = data?.track;
    if (!track) return;
    void Share.share({
      message: `${track.title} — ${track.artists.map((a) => a.name).join(', ')}`,
    });
  }, [data]);

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
                ? t('detail.notFoundBody', { type: t('detail.track') })
                : t('detail.errorBody')
          }
          retryLabel={t('common.retry')}
          onRetry={() => void refetch()}
        />
      </View>
    );
  }

  const { track } = data;
  const artists = track.artists.map((a) => a.name).join(', ');

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: tokens.colors.background }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <Artwork label={track.title} size={132} />
        <View style={styles.headerText}>
          <Text
            numberOfLines={2}
            style={[tokens.typography.title2, { color: tokens.colors.onBackground }]}
          >
            {track.title}
          </Text>
          <Text
            numberOfLines={1}
            style={[tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}
          >
            {artists}
          </Text>
          <Text
            numberOfLines={1}
            style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}
          >
            {[
              track.album?.title,
              track.releaseDate?.slice(0, 4),
              track.durationMs > 0 ? formatDuration(track.durationMs) : undefined,
            ]
              .filter((part): part is string => !!part)
              .join(' · ')}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <ActionChip prominent label={t('detail.play')} onPress={() => playTrack(track.id)} />
        <ActionChip label={t('detail.playNext')} onPress={() => addToQueue(track.id, true)} />
        <ActionChip label={t('detail.addToQueue')} onPress={() => addToQueue(track.id)} />
      </View>
      <View style={styles.actions}>
        <ActionChip label={t('detail.favorite')} onPress={() => undefined} disabled />
        <ActionChip
          label={downloadLabel()}
          onPress={jobStatus === 'COMPLETED' ? onRemoveDownload : onDownload}
        />
        <ActionChip label={t('detail.lyrics')} onPress={() => undefined} disabled />
        <ActionChip label={t('detail.share')} onPress={onShare} />
      </View>

      <View style={styles.footerNote}>
        <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
          {t('detail.comingSoon')}
        </Text>
      </View>
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
  footerNote: {
    marginTop: 24,
    alignItems: 'center',
  },
});
