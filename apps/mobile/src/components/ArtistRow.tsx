import { memo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { CanonicalArtist } from '@sinc/shared';
import { AppText } from './AppText';
import { useTheme } from '../theme';
import { artworkUrl } from '../api/artwork';

interface ArtistRowProps {
  artist: CanonicalArtist;
  onPress: () => void;
}

export const ArtistRow = memo(function ArtistRow({ artist, onPress }: ArtistRowProps) {
  const { radii, spacing } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, { padding: spacing.xs }, pressed && styles.pressed]}
    >
      <Image
        source={{ uri: artworkUrl(artist.artworkUrl) }}
        style={[styles.artwork, { borderRadius: radii.full }]}
      />
      <View style={styles.text}>
        <AppText variant="body" numberOfLines={1}>
          {artist.name}
        </AppText>
        <AppText variant="small" color="textSecondary">
          Artist
        </AppText>
      </View>
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
