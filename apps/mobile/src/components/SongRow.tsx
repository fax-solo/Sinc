import { memo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { CanonicalTrack } from '@sinc/shared';
import { AppText } from './AppText';
import { AddToPlaylistModal } from './AddToPlaylistModal';
import { useTheme } from '../theme';
import { useLibraryStore } from '../services/library/libraryStore';
import { useDownloadsStore } from '../services/library/downloadsStore';
import { artworkUrl } from '../api/artwork';

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface SongRowProps {
  track: CanonicalTrack;
  onPress: () => void;
  showDuration?: boolean;
  showFavorite?: boolean;
  showAdd?: boolean;
  showDownload?: boolean;
}

export const SongRow = memo(function SongRow({
  track,
  onPress,
  showDuration = true,
  showFavorite = false,
  showAdd = false,
  showDownload = false,
}: SongRowProps) {
  const { colors, radii, spacing } = useTheme();
  const isFavorite = useLibraryStore((s) => s.favoriteIds.has(track.id));
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const download = useDownloadsStore((s) => s.downloads.find((d) => d.track.id === track.id));
  const downloadTrack = useDownloadsStore((s) => s.downloadTrack);
  const [addVisible, setAddVisible] = useState(false);
  const artists = track.artists.map((a) => a.name).join(', ');
  const album = track.album?.title;
  const subtitle = album ? `${artists} · ${album}` : artists;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${track.title} by ${artists}`}
      style={({ pressed }) => [styles.row, { padding: spacing.xs }, pressed && styles.pressed]}
    >
      <Image
        source={artworkUrl(track.artworkUrl) ? { uri: artworkUrl(track.artworkUrl) } : undefined}
        style={[styles.artwork, { borderRadius: radii.sm }]}
      />
      <View style={styles.text}>
        <AppText variant="body" numberOfLines={1}>
          {track.title}
        </AppText>
        <AppText variant="small" color="textSecondary" numberOfLines={1}>
          {subtitle}
        </AppText>
      </View>
      {showFavorite ? (
        <Pressable
          onPress={() => toggleFavorite(track)}
          hitSlop={8}
          accessibilityLabel={isFavorite ? 'Unlike' : 'Like'}
        >
          <Ionicons
            name={isFavorite ? 'heart' : 'heart-outline'}
            size={20}
            color={isFavorite ? colors.accent : colors.textMuted}
          />
        </Pressable>
      ) : null}
      {showDownload ? (
        download?.phase === 'source' || download?.phase === 'transfer' ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : download?.phase === 'completed' ? (
          <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
        ) : download?.phase === 'failed' ? (
          <Pressable
            onPress={() => void downloadTrack(track)}
            hitSlop={8}
            accessibilityLabel="Retry download"
          >
            <Ionicons name="alert-circle-outline" size={22} color={colors.textSecondary} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void downloadTrack(track)}
            hitSlop={8}
            accessibilityLabel="Download"
          >
            <Ionicons name="download-outline" size={22} color={colors.textSecondary} />
          </Pressable>
        )
      ) : null}
      {showAdd ? (
        <>
          <Pressable
            onPress={() => setAddVisible(true)}
            hitSlop={8}
            accessibilityLabel="Add to playlist"
          >
            <Ionicons name="add-circle-outline" size={22} color={colors.textSecondary} />
          </Pressable>
          <AddToPlaylistModal
            track={track}
            visible={addVisible}
            onClose={() => setAddVisible(false)}
          />
        </>
      ) : null}
      {showDuration && track.durationMs > 0 ? (
        <AppText variant="caption" color="textSecondary">
          {formatDuration(track.durationMs)}
        </AppText>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  artwork: {
    width: 48,
    height: 48,
    backgroundColor: '#222',
  },
  text: {
    flex: 1,
  },
  pressed: {
    opacity: 0.7,
  },
});
