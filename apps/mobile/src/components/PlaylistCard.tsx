import { memo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { CanonicalPlaylist } from '@sinc/shared';
import { AppText } from './AppText';
import { useTheme } from '../theme';
import { artworkUrl } from '../api/artwork';

interface PlaylistCardProps {
  playlist: CanonicalPlaylist;
  onPress?: () => void;
}

export const PlaylistCard = memo(function PlaylistCard({ playlist, onPress }: PlaylistCardProps) {
  const { colors, radii, spacing } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : 'image'}
      accessibilityLabel={`Playlist ${playlist.name}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surfaceElevated, borderRadius: radii.md },
        pressed && styles.pressed,
      ]}
    >
      <Image
        source={{ uri: artworkUrl(playlist.artworkUrl) }}
        style={[styles.artwork, { borderRadius: radii.md }]}
      />
      <View style={{ padding: spacing.sm }}>
        <AppText variant="body" style={styles.text} numberOfLines={1}>
          {playlist.name}
        </AppText>
        <AppText variant="small" color="textSecondary" style={styles.text} numberOfLines={1}>
          {playlist.owner.name}
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
  text: {},
  pressed: {
    opacity: 0.7,
  },
});
