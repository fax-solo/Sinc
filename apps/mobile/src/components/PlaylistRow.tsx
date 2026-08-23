import { memo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { CanonicalPlaylist } from '@sinc/shared';
import { AppText } from './AppText';
import { useTheme } from '../theme';
import { artworkUrl } from '../api/artwork';

interface PlaylistRowProps {
  playlist: CanonicalPlaylist;
  onPress: () => void;
}

export const PlaylistRow = memo(function PlaylistRow({ playlist, onPress }: PlaylistRowProps) {
  const { radii, spacing } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, { padding: spacing.xs }, pressed && styles.pressed]}
    >
      <Image
        source={{ uri: artworkUrl(playlist.artworkUrl) }}
        style={[styles.artwork, { borderRadius: radii.sm }]}
      />
      <View style={styles.text}>
        <AppText variant="body" numberOfLines={1}>
          {playlist.name}
        </AppText>
        <AppText variant="small" color="textSecondary" numberOfLines={1}>
          {playlist.owner.name} · Playlist
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
