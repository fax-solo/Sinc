import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CanonicalTrack } from '@sinc/shared';
import { v2Spacing } from '../theme';
import { V2Text } from '../components/V2Text';
import { V2IconButton } from '../components/V2IconButton';
import { V2AlbumCard } from '../components/V2Cards';
import { V2Rail } from '../components/V2Section';
import { V2DetailShell } from './V2Detail';
import { musicApi, type DailyMix } from '../../api/music';
import { getCachedPersonalizedHome } from '../../api/resultCache';
import { useAuthStore } from '../../features/auth/authStore';
import { playerService } from '../../services/player/PlayerService';
import { recordCollectionPlay } from '../../services/library/sync';
import { shareEntity } from '../../utils/share';
import type { RootStackParamList } from '../../app/navigation/types';

const EMPTY_LIBRARY = {
  playlists: [],
  recentlyPlayedPlaylistIds: [],
  downloadedTracks: [],
  followedArtists: [],
  followedAlbums: [],
};

function usePlayTracks(collection?: {
  id: string;
  type: 'album' | 'playlist' | 'mix';
  title: string;
  subtitle: string;
  artworkUrl?: string | null;
}) {
  return useCallback(() => {
    if (collection)
      recordCollectionPlay({ ...collection, artworkUrl: collection.artworkUrl ?? undefined });
  }, [collection]);
}

export function V2AlbumScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Album'>) {
  const { id } = route.params ?? {};
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['album', id ?? 'missing'],
    queryFn: () => musicApi.getAlbum(id ?? 'missing'),
    enabled: !!id,
    retry: 1,
  });
  const record = usePlayTracks(
    data
      ? {
          id: data.album.id,
          type: 'album',
          title: data.album.title,
          subtitle: data.album.artist.name,
          artworkUrl: data.album.artworkUrl,
        }
      : undefined
  );

  const playTracks = useCallback(
    (tracks: CanonicalTrack[], index: number) => {
      record();
      void playerService.playQueue(tracks, index);
      navigation.navigate('Player');
    },
    [record, navigation]
  );

  if (!id) {
    return (
      <V2DetailShell
        title="Album"
        loading={false}
        loadError
        onRetry={() => navigation.goBack()}
        tracks={[]}
        onBack={() => navigation.goBack()}
        onPlayTracks={playTracks}
      />
    );
  }

  return (
    <V2DetailShell
      title={data?.album.title ?? route.params?.title ?? 'Album'}
      subtitle={data?.album.artist.name}
      meta={data ? `${data.tracks.length} songs` : undefined}
      artworkUri={data?.album.artworkUrl}
      loading={isLoading}
      loadError={isError}
      onRetry={() => void refetch()}
      tracks={data?.tracks ?? []}
      onBack={() => navigation.goBack()}
      onPlayTracks={playTracks}
      headerAction={
        data ? (
          <V2IconButton
            name="share-social-outline"
            label="Share album"
            onPress={() =>
              void shareEntity({
                type: 'album',
                id: data.album.id,
                title: data.album.title,
                subtitle: data.album.artist.name,
              })
            }
          />
        ) : undefined
      }
    />
  );
}

export function V2ArtistScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Artist'>) {
  const { id } = route.params ?? {};
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['artist', id ?? 'missing'],
    queryFn: () => musicApi.getArtist(id ?? 'missing'),
    enabled: !!id,
    retry: 1,
  });

  const playTracks = useCallback(
    (tracks: CanonicalTrack[], index: number) => {
      void playerService.playQueue(tracks, index);
      navigation.navigate('Player');
    },
    [navigation]
  );

  const topTracks = data?.topTracks ?? [];

  return (
    <V2DetailShell
      title={data?.artist.name ?? route.params?.name ?? 'Artist'}
      subtitle="Artist"
      meta={data ? `${topTracks.length} top songs · ${data.albums.length} albums` : undefined}
      artworkUri={data?.artist.artworkUrl}
      loading={isLoading}
      loadError={isError}
      onRetry={() => void refetch()}
      tracks={topTracks}
      onBack={() => navigation.goBack()}
      onPlayTracks={playTracks}
      extraActions={
        data && data.albums.length > 0 ? (
          <View style={{ marginTop: v2Spacing.xl }}>
            <V2Text variant="headline" style={{ marginBottom: v2Spacing.sm }}>
              Albums
            </V2Text>
            <V2Rail
              items={data.albums}
              keyOf={(a) => a.id}
              renderItem={(a) => (
                <V2AlbumCard
                  album={a}
                  onPress={() => navigation.navigate('Album', { id: a.id, title: a.title })}
                />
              )}
            />
          </View>
        ) : undefined
      }
    />
  );
}

export function V2PlaylistScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Playlist'>) {
  const { id } = route.params ?? {};
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['playlist', id ?? 'missing'],
    queryFn: () => musicApi.getPlaylist(id ?? 'missing'),
    enabled: !!id,
    retry: 1,
  });
  const tracks = data?.tracks ?? [];
  const record = usePlayTracks(
    data
      ? {
          id: data.playlist.id,
          type: 'playlist',
          title: data.playlist.name,
          subtitle: data.playlist.owner.name,
          artworkUrl: data.playlist.artworkUrl,
        }
      : undefined
  );

  const playTracks = useCallback(
    (list: CanonicalTrack[], index: number) => {
      record();
      void playerService.playQueue(list, index);
      navigation.navigate('Player');
    },
    [record, navigation]
  );

  return (
    <V2DetailShell
      title={data?.playlist.name ?? route.params?.name ?? 'Playlist'}
      subtitle={data?.playlist.owner.name}
      meta={`${tracks.length} songs`}
      artworkUri={data?.playlist.artworkUrl}
      loading={isLoading}
      loadError={isError}
      onRetry={() => void refetch()}
      emptyHint="Nothing here yet."
      tracks={tracks}
      onBack={() => navigation.goBack()}
      onPlayTracks={playTracks}
      headerAction={
        data ? (
          <V2IconButton
            name="share-social-outline"
            label="Share playlist"
            onPress={() =>
              void shareEntity({
                type: 'playlist',
                id: data.playlist.id,
                title: data.playlist.name,
                subtitle: data.playlist.owner.name,
              })
            }
          />
        ) : undefined
      }
    />
  );
}

function findMix(
  feed: { sections: Array<{ kind: string; mixes?: DailyMix[] }> } | null,
  mixId: string
): DailyMix | null {
  for (const section of feed?.sections ?? []) {
    if (section.kind === 'mixes') {
      const found = section.mixes?.find((m) => m.id === mixId);
      if (found) return found;
    }
  }
  return null;
}

export function V2MixScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Mix'>) {
  // Missing params degrade to the failed state in the phase memo below.
  const { mix, mixId } = route.params ?? {};
  const userId = useAuthStore((s) => s.user?.id);

  const phase = useMemo(() => {
    if (mix) return { kind: 'ready', mix } as const;
    if (!mixId) return { kind: 'failed' } as const;
    const cached = findMix(getCachedPersonalizedHome(userId ?? '')?.data ?? null, mixId);
    if (cached) return { kind: 'ready', mix: cached } as const;
    return { kind: 'loading' } as const;
  }, [mix, mixId, userId]);

  const [remoteMix, setRemoteMix] = useState<DailyMix | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Bumped by Retry so the fetch effect below actually re-runs.
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (phase.kind !== 'loading') return;
    let cancelled = false;
    void musicApi
      .getPersonalizedHomeFeed(EMPTY_LIBRARY)
      .then((feed) => {
        if (cancelled) return;
        const found = mixId ? findMix(feed, mixId) : null;
        if (found) setRemoteMix(found);
        else setLoadError(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [phase.kind, mixId, retryKey]);

  // No plausible mix id (deep-link garbage) — back is the only sane action.
  const onRetry = useMemo(() => {
    if (phase.kind === 'failed') return () => navigation.goBack();
    return () => {
      setRemoteMix(null);
      setLoadError(false);
      setRetryKey((k) => k + 1);
    };
  }, [phase.kind, navigation]);

  const resolved = phase.kind === 'ready' ? phase.mix : remoteMix;
  const loading = phase.kind === 'loading' && !remoteMix;
  const failed = phase.kind === 'failed' || loadError;
  const record = usePlayTracks(
    resolved
      ? {
          id: resolved.id,
          type: 'mix',
          title: resolved.name,
          subtitle: resolved.genre,
          artworkUrl: resolved.artworkUrl,
        }
      : undefined
  );

  const playTracks = useCallback(
    (tracks: CanonicalTrack[], index: number) => {
      record();
      void playerService.playQueue(tracks, index);
      navigation.navigate('Player');
    },
    [record, navigation]
  );

  return (
    <V2DetailShell
      title={resolved?.name ?? 'Mix'}
      subtitle={resolved ? `Made for you · ${resolved.genre}` : undefined}
      meta={resolved ? `${resolved.tracks.length} songs` : undefined}
      artworkUri={resolved?.artworkUrl}
      loading={loading}
      loadError={failed}
      onRetry={onRetry}
      tracks={resolved?.tracks ?? []}
      onBack={() => navigation.goBack()}
      onPlayTracks={playTracks}
      headerAction={
        resolved ? (
          <V2IconButton
            name="share-social-outline"
            label="Share mix"
            onPress={() =>
              void shareEntity({
                type: 'mix',
                id: resolved.id,
                title: resolved.name,
                subtitle: resolved.genre,
              })
            }
          />
        ) : undefined
      }
    />
  );
}
