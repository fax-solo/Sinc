import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRoute, type RouteProp } from '@react-navigation/native';
import type { CanonicalTrack } from '@sinc/shared';
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

type Route = RouteProp<SearchTabParamList, 'ArtistDetails'>;

function InfoRow({
  label,
  caption,
  onPress,
}: {
  label: string;
  caption?: string;
  onPress?: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const body = (
    <>
      <View style={[styles.infoArtwork, { backgroundColor: tokens.colors.surfaceContainerHigh }]}>
        <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
          {label.slice(0, 1)}
        </Text>
      </View>
      <View style={styles.infoText}>
        <Text
          numberOfLines={1}
          style={[tokens.typography.body, { color: tokens.colors.onSurface }]}
        >
          {label}
        </Text>
        {caption ? (
          <Text
            numberOfLines={1}
            style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}
          >
            {caption}
          </Text>
        ) : null}
      </View>
    </>
  );
  if (!onPress) {
    return <View style={styles.row}>{body}</View>;
  }
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={styles.row}>
      {body}
    </TouchableOpacity>
  );
}

export default function ArtistDetailsScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const route = useRoute<Route>();
  const { artistId } = route.params;

  const { state, data, refetch } = useDetailQuery(['artist-detail', artistId], () =>
    musicApi.getArtistDetail(artistId),
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
                ? t('detail.notFoundBody', { type: t('detail.artist') })
                : t('detail.errorBody')
          }
          retryLabel={t('common.retry')}
          onRetry={() => void refetch()}
        />
      </View>
    );
  }

  const { artist, topTracks, albums, relatedArtists } = data;
  const empty = topTracks.length === 0 && albums.length === 0 && relatedArtists.length === 0;

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: tokens.colors.background }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <Artwork label={artist.name} size={132} />
        <View style={styles.headerText}>
          <Text
            numberOfLines={2}
            style={[tokens.typography.title2, { color: tokens.colors.onBackground }]}
          >
            {artist.name}
          </Text>
          {artist.genres && artist.genres.length > 0 ? (
            <Text
              numberOfLines={1}
              style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}
            >
              {artist.genres.join(', ')}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.actions}>
        <ActionChip prominent label={t('detail.favorite')} onPress={() => undefined} disabled />
        <ActionChip label={t('detail.share')} onPress={() => undefined} disabled />
      </View>

      {empty ? (
        <EmptyState title={t('detail.emptyArtistTitle')} body={t('detail.emptyArtistBody')} />
      ) : (
        <>
          {topTracks.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader>{t('detail.topTracks')}</SectionHeader>
              {topTracks.map((track: CanonicalTrack, index: number) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={index + 1}
                  onPress={() => playTrack(track.id)}
                />
              ))}
              <View style={styles.actions}>
                <ActionChip
                  label={t('detail.play')}
                  onPress={() => topTracks[0] && playTrack(topTracks[0].id)}
                />
                <ActionChip
                  label={t('detail.addAllToQueue')}
                  onPress={() => topTracks.forEach((track) => addToQueue(track.id))}
                />
              </View>
            </View>
          ) : null}

          {albums.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader>{t('detail.albums')}</SectionHeader>
              {albums.map((album) => (
                <InfoRow
                  key={album.id}
                  label={album.title}
                  caption={album.releaseDate?.slice(0, 4) ?? t('detail.unknownYear')}
                />
              ))}
            </View>
          ) : null}

          {relatedArtists.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader>{t('detail.relatedArtists')}</SectionHeader>
              {relatedArtists.map((related) => (
                <InfoRow key={related.id} label={related.name} caption={t('detail.artist')} />
              ))}
            </View>
          ) : null}
        </>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  infoArtwork: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: {
    flex: 1,
    gap: 1,
  },
});
