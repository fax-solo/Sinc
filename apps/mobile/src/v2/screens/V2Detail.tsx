import { useCallback, useEffect } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import type { CanonicalTrack } from '@sinc/shared';
import { shuffled as shuffledList } from '../../services/local/affinity';
import { v2Colors, v2Spacing } from '../theme';
import { V2Text } from '../components/V2Text';
import { V2Button } from '../components/V2Button';
import { V2Artwork } from '../components/V2Artwork';
import { V2TrackRow } from '../components/V2TrackRow';
import { V2Header } from '../components/V2Header';
import { V2Empty } from '../components/V2State';
import { playerService } from '../../services/player/PlayerService';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import type { RootStackParamList } from '../../app/navigation/types';

const TRACK_ROW_HEIGHT = 68;

interface V2DetailShellProps {
  title: string;
  subtitle?: string;
  meta?: string;
  artworkUri?: string | null;
  loading: boolean;
  loadError?: boolean;
  onRetry?: () => void;
  emptyHint?: string;
  tracks: CanonicalTrack[];
  onBack: () => void;
  headerAction?: React.ReactNode;
  extraActions?: React.ReactNode;
  onPlayTracks: (tracks: CanonicalTrack[], index: number) => void;
}

/**
 * Shared hero + track-list layout for album / artist / playlist / mix pages:
 * round back header, big rounded artwork, bold title block, pill Play + Shuffle,
 * then roomy track rows.
 */
export function V2DetailShell({
  title,
  subtitle,
  meta,
  artworkUri,
  loading,
  loadError,
  onRetry,
  emptyHint,
  tracks,
  onBack,
  headerAction,
  extraActions,
  onPlayTracks,
}: V2DetailShellProps) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // Warm the list's head track in the background while the user reads the
  // page: their most likely first tap then starts from the stream cache.
  useEffect(() => {
    if (!loading && !loadError && tracks.length > 0) {
      playerService.warmUpcoming(tracks);
    }
  }, [tracks, loading, loadError]);

  const playAll = useCallback(
    (shuffled: boolean) => {
      if (tracks.length === 0) return;
      const queue = shuffled ? shuffledList(tracks, Math.random) : tracks;
      void playerService.playQueue(queue, 0);
      navigation.navigate('Player');
    },
    [tracks, navigation]
  );

  return (
    <FlatList
      style={{ backgroundColor: v2Colors.background, flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: v2Spacing.md, paddingBottom: v2Spacing.xxxl }}
      data={loading || loadError ? [] : tracks}
      keyExtractor={(t) => t.id}
      getItemLayout={(_, index) => ({
        length: TRACK_ROW_HEIGHT,
        offset: TRACK_ROW_HEIGHT * index,
        index,
      })}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      renderItem={({ item, index }) => (
        <V2TrackRow
          track={item}
          showFavorite
          showAdd
          showDownload
          onPress={() => onPlayTracks(tracks, index)}
        />
      )}
      ListHeaderComponent={
        <View>
          <V2Header title={title} onBack={onBack} right={headerAction} />
          {loading ? (
            <ActivityIndicator color={v2Colors.accent} style={{ marginTop: v2Spacing.xxl }} />
          ) : null}
          {loadError ? (
            <View style={{ alignItems: 'center', marginTop: v2Spacing.xxl, gap: v2Spacing.sm }}>
              <V2Text variant="body" color="error" style={{ textAlign: 'center' }}>
                Couldn't load this page.
              </V2Text>
              {onRetry ? <V2Button label="Retry" onPress={onRetry} compact /> : null}
            </View>
          ) : null}
          {!loading && !loadError ? (
            <>
              <View style={{ alignItems: 'center', marginTop: v2Spacing.sm }}>
                <View
                  style={{
                    borderRadius: 28,
                    shadowColor: '#000',
                    shadowOpacity: 0.45,
                    shadowRadius: 20,
                    shadowOffset: { width: 0, height: 10 },
                    elevation: 10,
                  }}
                >
                  <V2Artwork uri={artworkUri} size={210} radius={28} />
                </View>
                <V2Text
                  variant="title"
                  style={{ textAlign: 'center', marginTop: v2Spacing.md }}
                  numberOfLines={2}
                >
                  {title}
                </V2Text>
                {subtitle ? (
                  <V2Text
                    variant="body"
                    color="textSecondary"
                    style={{ marginTop: 2 }}
                    numberOfLines={1}
                  >
                    {subtitle}
                  </V2Text>
                ) : null}
                {meta ? (
                  <V2Text variant="small" color="textMuted" style={{ marginTop: 2 }}>
                    {meta}
                  </V2Text>
                ) : null}
              </View>
              {tracks.length > 0 ? (
                <View style={{ flexDirection: 'row', gap: v2Spacing.sm, marginTop: v2Spacing.lg }}>
                  <View style={{ flex: 1 }}>
                    <V2Button label="Play" onPress={() => playAll(false)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <V2Button label="Shuffle" variant="secondary" onPress={() => playAll(true)} />
                  </View>
                </View>
              ) : null}
              {extraActions}
            </>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        !loading && !loadError ? (
          <V2Empty icon="musical-notes" title="No songs here yet" hint={emptyHint} />
        ) : null
      }
    />
  );
}
