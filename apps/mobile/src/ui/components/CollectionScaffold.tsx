import { useEffect, type ReactNode } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { LinearGradient } from 'react-native-linear-gradient';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { CanonicalTrack } from '@sinc/shared';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';
import { Artwork } from './Artwork';
import { IconButton } from './Buttons';
import { SongRow } from './SongRow';
import { EmptyState, ErrorState, ListSkeleton, SkeletonBlock } from './State';
import { colors, radii, spacing } from '../theme';
import { playerService } from '../../services/player/PlayerService';

interface CollectionScaffoldProps {
  label: string;
  title: string;
  subtitle?: string;
  description?: string;
  artworkUri?: string | null;
  meta?: string;
  tracks: CanonicalTrack[];
  loading?: boolean;
  error?: boolean;
  errorMessage?: string;
  onBack: () => void;
  onRetry?: () => void;
  headerRight?: ReactNode;
  onPlayAll: () => void;
  onShuffleAll: () => void;
  onPlayTrack: (track: CanonicalTrack, index: number) => void;
  quickActions?: ReactNode;
  beforeTracks?: ReactNode;
  afterTracks?: ReactNode;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  downloadedIds?: Set<string>;
  currentTrackId?: string;
  isPlaying?: boolean;
  onMoreTrack?: (track: CanonicalTrack, index: number) => void;
  renderTrailing?: (track: CanonicalTrack, index: number) => ReactNode;
  trackIndexOffset?: number;
  tracklistLabel?: string;
}

export function CollectionScaffold({
  label,
  title,
  subtitle,
  description,
  artworkUri,
  meta,
  tracks,
  loading,
  error,
  errorMessage,
  onBack,
  onRetry,
  headerRight,
  onPlayAll,
  onShuffleAll,
  onPlayTrack,
  quickActions,
  beforeTracks,
  afterTracks,
  emptyTitle = 'Nothing here yet',
  emptyMessage,
  emptyActionLabel,
  onEmptyAction,
  downloadedIds,
  currentTrackId,
  isPlaying,
  onMoreTrack,
  renderTrailing,
  trackIndexOffset = 0,
  tracklistLabel = 'TRACKLIST',
}: CollectionScaffoldProps) {
  const insets = useSafeAreaInsets();

  // Opening a collection is the strongest signal of what plays next; warm the
  // head track so the first tap usually starts from the prefetch cache.
  useEffect(() => {
    if (tracks.length > 0) playerService.warmUpcoming(tracks);
  }, [tracks]);

  const topBar = (
    <View
      style={{
        paddingTop: insets.top + spacing.xs,
        paddingHorizontal: spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
      }}
    >
      <IconButton
        icon="chevron-down"
        label="Close"
        size={38}
        background="rgba(255,255,255,0.08)"
        onPress={onBack}
      />
      <Text variant="micro" style={{ color: colors.textSecondary, flex: 1, textAlign: 'center' }}>
        {label.toUpperCase()}
      </Text>
      <View style={{ minWidth: 38, alignItems: 'flex-end' }}>{headerRight}</View>
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {topBar}
        <View style={{ padding: spacing.lg, alignItems: 'center', gap: spacing.md }}>
          <SkeletonBlock height={210} width={210} radius={radii.lg} />
          <SkeletonBlock height={24} width="60%" />
          <SkeletonBlock height={14} width="40%" />
          <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
            <SkeletonBlock height={48} width={130} radius={radii.full} />
            <SkeletonBlock height={48} width={48} radius={radii.full} />
          </View>
        </View>
        <View style={{ padding: spacing.lg }}>
          <ListSkeleton rows={6} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {topBar}
        <ErrorState
          title="This page could not load"
          message={errorMessage ?? 'Check your connection and try again.'}
          onRetry={onRetry}
        />
      </View>
    );
  }

  const header = (
    <View>
      <LinearGradient
        colors={['rgba(30,215,96,0.16)', 'rgba(11,15,14,0)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{
          position: 'absolute',
          top: -insets.top,
          left: -20,
          right: -20,
          height: 420,
        }}
      />
      <View style={{ alignItems: 'center', paddingTop: spacing.md, gap: spacing.sm }}>
        <Artwork
          uri={artworkUri}
          size={212}
          radius={radii.lg}
          accessibilityLabel={`${title} artwork`}
          style={{
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.08)',
            shadowColor: '#000',
            shadowOpacity: 0.35,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 14 },
          }}
        />
        <Text
          variant="micro"
          style={{ color: colors.accentBright, marginTop: spacing.xs, textAlign: 'center' }}
        >
          {label.toUpperCase()}
        </Text>
        <Text variant="title" align="center" style={{ paddingHorizontal: spacing.sm }}>
          {title}
        </Text>
        {subtitle ? (
          <View style={{ paddingHorizontal: spacing.sm }}>
            <Text variant="bodyLarge" color="textSecondary" align="center">
              {subtitle}
            </Text>
          </View>
        ) : null}
        {description ? (
          <Text
            variant="small"
            align="center"
            style={{ paddingHorizontal: spacing.lg, lineHeight: 19 }}
          >
            {description}
          </Text>
        ) : null}
        {meta ? (
          <Text variant="caption" align="center">
            {meta}
          </Text>
        ) : null}
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          marginTop: spacing.lg,
        }}
      >
        <Pressable
          onPress={onPlayAll}
          disabled={tracks.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Play"
          style={({ pressed }) => ({
            flex: 1,
            height: 50,
            borderRadius: radii.full,
            backgroundColor: colors.accent,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            opacity: tracks.length === 0 ? 0.4 : pressed ? 0.78 : 1,
          })}
        >
          <Ionicons name="play" size={19} color={colors.onAccent} />
          <Text variant="bodyLarge" style={{ color: colors.onAccent, fontWeight: '800' }}>
            Play
          </Text>
        </Pressable>
        <Pressable
          onPress={onShuffleAll}
          disabled={tracks.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Shuffle"
          style={({ pressed }) => ({
            width: 50,
            height: 50,
            borderRadius: 25,
            backgroundColor: colors.card,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: tracks.length === 0 ? 0.4 : pressed ? 0.68 : 1,
          })}
        >
          <Ionicons name="shuffle" size={21} color={colors.text} />
        </Pressable>
        {quickActions}
      </View>

      {beforeTracks}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: spacing.xl,
          marginBottom: spacing.xs,
        }}
      >
        <Text variant="micro">{tracklistLabel}</Text>
        <Text variant="caption">{tracks.length} songs</Text>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {topBar}
      <FlatList
        data={tracks}
        keyExtractor={(track, index) => `${track.id}-${index}`}
        ListHeaderComponent={header}
        ListFooterComponent={afterTracks ? <>{afterTracks}</> : null}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: spacing.xxl + insets.bottom }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            icon="musical-notes-outline"
            title={emptyTitle}
            message={emptyMessage}
            actionLabel={emptyActionLabel}
            onAction={onEmptyAction}
          />
        }
        renderItem={({ item, index }) => (
          <SongRow
            track={item}
            showIndex={index + 1 + trackIndexOffset}
            downloaded={downloadedIds?.has(item.id)}
            isCurrent={currentTrackId === item.id}
            isPlaying={isPlaying}
            onPress={() => onPlayTrack(item, index)}
            onMore={onMoreTrack ? () => onMoreTrack(item, index) : undefined}
            trailing={renderTrailing?.(item, index)}
          />
        )}
      />
    </View>
  );
}
