import { memo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { CanonicalTrack } from '@sinc/shared';
import { v2Colors, v2Spacing } from '../theme';
import { V2Text } from './V2Text';
import { V2Artwork } from './V2Artwork';
import { V2AddSheet } from './V2AddSheet';
import { formatDuration } from '../../utils/format';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';

interface V2TrackRowProps {
  track: CanonicalTrack;
  onPress: () => void;
  showFavorite?: boolean;
  showAdd?: boolean;
  showDownload?: boolean;
  showDuration?: boolean;
  trailing?: React.ReactNode;
}

/**
 * Roomy 68px song row: 52px artwork with built-in placeholder, two-line
 * metadata, and a calm icon cluster (heart / download state / duration).
 */
export const V2TrackRow = memo(function V2TrackRow({
  track,
  onPress,
  showFavorite = false,
  showAdd = false,
  showDownload = false,
  showDuration = true,
  trailing,
}: V2TrackRowProps) {
  const isFavorite = useLibraryStore((s) => s.favoriteIds.has(track.id));
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  // Phase-only subscription: the downloads array identity changes on every
  // upsert and would otherwise re-render every visible row on each tick.
  const downloadPhase = useDownloadsStore(
    (s) => s.downloads.find((d) => d.track.id === track.id)?.phase
  );
  const downloadTrack = useDownloadsStore((s) => s.downloadTrack);
  const [sheetVisible, setSheetVisible] = useState(false);

  const artists = track.artists.map((a) => a.name).join(', ');
  const album = track.album?.title;
  const subtitle = album ? `${artists} · ${album}` : artists;
  const busy = downloadPhase === 'source' || downloadPhase === 'transfer';
  // Spotify signature: the row that is playing right now lights up green.
  const isCurrent = usePlayerStore((s) => selectCurrentTrack(s)?.id === track.id);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${track.title} by ${artists}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: v2Spacing.sm,
        // Fixed 68px so getItemLayout/scroll math stays exact even with
        // larger system font sizes (art 48 + 2*8 padding).
        height: 68,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <V2Artwork uri={track.artworkUrl} size={48} radius={4} />
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <V2Text
          variant="body"
          color={isCurrent ? 'accent' : 'textPrimary'}
          style={{ fontWeight: '600' }}
          numberOfLines={1}
        >
          {track.title}
        </V2Text>
        <V2Text variant="small" color="textSecondary" numberOfLines={1}>
          {subtitle}
        </V2Text>
      </View>
      {showFavorite ? (
        <Pressable
          onPress={() => toggleFavorite(track)}
          hitSlop={10}
          accessibilityLabel={isFavorite ? 'Unlike' : 'Like'}
        >
          <Ionicons
            name={isFavorite ? 'heart' : 'heart-outline'}
            size={22}
            color={isFavorite ? v2Colors.accent : v2Colors.textMuted}
          />
        </Pressable>
      ) : null}
      {showDownload ? (
        busy ? (
          <ActivityIndicator size="small" color={v2Colors.accent} />
        ) : downloadPhase === 'completed' ? (
          <Ionicons name="checkmark-circle" size={24} color={v2Colors.accent} />
        ) : downloadPhase === 'failed' ? (
          <Pressable
            onPress={() => void downloadTrack(track)}
            hitSlop={10}
            accessibilityLabel="Retry download"
          >
            <Ionicons name="refresh-circle-outline" size={24} color={v2Colors.warning} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void downloadTrack(track)}
            hitSlop={10}
            accessibilityLabel="Download"
          >
            <Ionicons name="arrow-down-circle-outline" size={24} color={v2Colors.textSecondary} />
          </Pressable>
        )
      ) : null}
      {showAdd ? (
        <>
          <Pressable
            onPress={() => setSheetVisible(true)}
            hitSlop={10}
            accessibilityLabel="Add to playlist"
          >
            <Ionicons name="add-circle-outline" size={24} color={v2Colors.textSecondary} />
          </Pressable>
          <V2AddSheet track={track} visible={sheetVisible} onClose={() => setSheetVisible(false)} />
        </>
      ) : null}
      {trailing}
      {showDuration && track.durationMs > 0 ? (
        <V2Text variant="caption" color="textMuted">
          {formatDuration(track.durationMs)}
        </V2Text>
      ) : null}
    </Pressable>
  );
});
