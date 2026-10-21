import { memo } from 'react';
import { Image, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { v2Colors } from '../theme';
import { artworkUrl } from '../../api/artwork';

interface V2ArtworkProps {
  uri?: string | null;
  size: number;
  radius?: number;
  iconRatio?: number;
}

/** Artwork with a built-in music-note placeholder — no blank holes while loading. */
export const V2Artwork = memo(function V2Artwork({
  uri,
  size,
  radius,
  iconRatio = 0.42,
}: V2ArtworkProps) {
  const resolved = artworkUrl(uri);
  const borderRadius = radius ?? Math.round(size * 0.22);
  if (resolved) {
    return (
      <Image
        source={{ uri: resolved }}
        style={{
          width: size,
          height: size,
          borderRadius,
          backgroundColor: v2Colors.surfaceElevated,
        }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius,
        backgroundColor: v2Colors.surfaceElevated,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons
        name="musical-note"
        size={Math.round(size * iconRatio)}
        color={v2Colors.textMuted}
      />
    </View>
  );
});
