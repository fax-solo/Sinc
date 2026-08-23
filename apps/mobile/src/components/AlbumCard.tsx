import { memo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { CanonicalAlbum } from '@sinc/shared';
import { AppText } from './AppText';
import { useTheme } from '../theme';
import { artworkUrl } from '../api/artwork';

interface AlbumCardProps {
  album: CanonicalAlbum;
  onPress?: () => void;
}

export const AlbumCard = memo(function AlbumCard({ album, onPress }: AlbumCardProps) {
  const { colors, radii, spacing } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : 'image'}
      accessibilityLabel={`Album ${album.title} by ${album.artist.name}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surfaceElevated, borderRadius: radii.md },
        pressed && styles.pressed,
      ]}
    >
      <Image
        source={{ uri: artworkUrl(album.artworkUrl) }}
        style={[styles.artwork, { borderRadius: radii.md }]}
      />
      <View style={{ padding: spacing.sm }}>
        <AppText variant="body" style={styles.text} numberOfLines={1}>
          {album.title}
        </AppText>
        <AppText variant="small" color="textSecondary" style={styles.text} numberOfLines={1}>
          {album.artist.name}
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
