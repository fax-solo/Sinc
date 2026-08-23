import { memo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { CanonicalArtist } from '@sinc/shared';
import { AppText } from './AppText';
import { useTheme } from '../theme';
import { artworkUrl } from '../api/artwork';

interface ArtistCardProps {
  artist: CanonicalArtist;
  onPress: () => void;
}

export const ArtistCard = memo(function ArtistCard({ artist, onPress }: ArtistCardProps) {
  const { colors, radii, spacing } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Artist ${artist.name}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surfaceElevated, borderRadius: radii.md },
        pressed && styles.pressed,
      ]}
    >
      <Image
        source={{ uri: artworkUrl(artist.artworkUrl) }}
        style={[styles.artwork, { borderRadius: radii.full }]}
      />
      <View style={{ padding: spacing.sm }}>
        <AppText variant="body" style={styles.text} numberOfLines={1}>
          {artist.name}
        </AppText>
        <AppText variant="small" color="textSecondary" style={styles.text} numberOfLines={1}>
          Artist
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
