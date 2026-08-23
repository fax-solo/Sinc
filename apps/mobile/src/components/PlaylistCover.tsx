/**
 * Cover art for a local playlist: uses the first track that has artwork,
 * falling back to the music-note tile when the playlist has no artwork yet.
 */
import { memo } from 'react';
import { Image, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { CanonicalTrack } from '@sinc/shared';
import { useTheme } from '../theme';
import { artworkUrl } from '../api/artwork';

export const playlistArtworkUrl = (tracks: CanonicalTrack[]): string | undefined =>
  tracks.find((t) => t.artworkUrl)?.artworkUrl;

export const PlaylistCover = memo(function PlaylistCover({
  tracks,
  size,
  borderRadius,
}: {
  tracks: CanonicalTrack[];
  size: number;
  borderRadius?: number;
}) {
  const { colors } = useTheme();
  const uri = artworkUrl(playlistArtworkUrl(tracks));

  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius }} />;
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius,
        backgroundColor: '#7B5DD6',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons
        name="musical-notes"
        size={Math.round(size * 0.45)}
        color={colors.onAccent ?? '#000'}
      />
    </View>
  );
});
