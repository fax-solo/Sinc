import { memo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { CanonicalTrack } from '@sinc/shared';
import { AppText } from './AppText';
import { useTheme } from '../theme';
import { useLibraryStore } from '../services/library/libraryStore';
import { useDownloadsStore } from '../services/library/downloadsStore';
import { artworkUrl } from '../api/artwork';

interface TrackCardProps {
  track: CanonicalTrack;
  onPress: () => void;
}

export const TrackCard = memo(function TrackCard({ track, onPress }: TrackCardProps) {
  const { colors, radii, spacing } = useTheme();
  const artist = track.artists[0]?.name ?? 'Unknown artist';
  const isFavorite = useLibraryStore((s) => s.favoriteIds.has(track.id));
  const isDownloaded = useDownloadsStore((s) => s.downloadedIds.has(track.id));
  const thumbsUpAt = useLibraryStore((s) => s.thumbsUp[track.id]);
  const thumbsDownAt = useLibraryStore((s) => s.thumbsDown[track.id]);
  const thumb: 'up' | 'down' | undefined = thumbsUpAt ? 'up' : thumbsDownAt ? 'down' : undefined;

  const toggleThumb = (value: 'up' | 'down') => {
    useLibraryStore.getState().setThumb(track.id, thumb === value ? 'none' : value);
  };

  const hide = () => {
    useLibraryStore.getState().hideTrack(track.id);
    if (artist !== 'Unknown artist') useLibraryStore.getState().hideArtist(artist);
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={hide}
      accessibilityRole="button"
      accessibilityLabel={`${track.title} by ${artist}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surfaceElevated, borderRadius: radii.md },
        pressed && styles.pressed,
      ]}
    >
      <View>
        <Image
          source={{ uri: artworkUrl(track.artworkUrl) }}
          style={[styles.artwork, { borderRadius: radii.md }]}
        />
        {(isFavorite || isDownloaded) && (
          <View style={[styles.badgeRow, { gap: spacing.xxs }]}>
            {isFavorite ? <View style={[styles.badge, { backgroundColor: colors.error }]} /> : null}
            {isDownloaded ? (
              <View style={[styles.badge, { backgroundColor: colors.success }]} />
            ) : null}
          </View>
        )}
        <View style={[styles.thumbRow, { gap: spacing.xxs }]}>
          <Pressable
            onPress={() => toggleThumb('up')}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={thumb === 'up' ? 'Clear thumbs up' : 'Thumbs up'}
            style={[
              styles.thumbButton,
              {
                backgroundColor: thumb === 'up' ? colors.accent : colors.surfaceElevated,
                borderRadius: radii.full,
              },
            ]}
          >
            <AppText
              variant="small"
              style={{ color: thumb === 'up' ? colors.onAccent : colors.textPrimary }}
            >
              ▲
            </AppText>
          </Pressable>
          <Pressable
            onPress={() => toggleThumb('down')}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={thumb === 'down' ? 'Clear thumbs down' : 'Thumbs down'}
            style={[
              styles.thumbButton,
              {
                backgroundColor: thumb === 'down' ? colors.error : colors.surfaceElevated,
                borderRadius: radii.full,
              },
            ]}
          >
            <AppText
              variant="small"
              style={{ color: thumb === 'down' ? colors.onAccent : colors.textPrimary }}
            >
              ▼
            </AppText>
          </Pressable>
        </View>
      </View>
      <View style={{ padding: spacing.sm }}>
        <AppText variant="body" style={styles.title} numberOfLines={1}>
          {track.title}
        </AppText>
        <AppText variant="small" color="textSecondary" style={styles.title} numberOfLines={1}>
          {artist}
        </AppText>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    width: 150,
  },
  artwork: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#222',
  },
  badgeRow: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    flexDirection: 'row',
  },
  badge: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  thumbRow: {
    position: 'absolute',
    top: 6,
    right: 6,
    flexDirection: 'row',
  },
  thumbButton: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {},
  pressed: {
    opacity: 0.7,
  },
});
