import { memo, useEffect, useState } from 'react';
import {
  Image,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { artworkUrl } from '../../api/artwork';
import { colors } from '../theme';

interface ArtworkProps {
  uri?: string | null;
  size: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  iconSize?: number;
  accessibilityLabel?: string;
}

/**
 * Artwork with a stable placeholder. It never stretches: the image is exactly
 * `size` square and clips inside the requested radius.
 */
export const Artwork = memo(function Artwork({
  uri,
  size,
  radius,
  style,
  iconSize,
  accessibilityLabel,
}: ArtworkProps) {
  const resolved = artworkUrl(uri);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolved]);

  const borderRadius = radius ?? 10;

  if (resolved && !failed) {
    return (
      <Image
        source={{ uri: resolved }}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.image,
          { width: size, height: size, borderRadius, backgroundColor: colors.card },
          style as StyleProp<ImageStyle>,
        ]}
        resizeMode="cover"
      />
    );
  }

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.placeholder,
        { width: size, height: size, borderRadius },
        style,
      ]}
    >
      <Ionicons name="musical-note" size={iconSize ?? Math.round(size * 0.34)} color={colors.textMuted} />
    </View>
  );
});

const styles = StyleSheet.create({
  image: {
    overflow: 'hidden',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
});
