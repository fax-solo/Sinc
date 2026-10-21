import { memo } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type {
  CanonicalAlbum,
  CanonicalArtist,
  CanonicalPlaylist,
  CanonicalTrack,
} from '@sinc/shared';
import type { DailyMix } from '../../api/music';
import { v2Colors, v2Spacing } from '../theme';
import { V2Text } from './V2Text';
import { V2Artwork } from './V2Artwork';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { playlistArtworkUrl } from '../../components/PlaylistCover';

const CARD_WIDTH = 148;
/** Spotify's shelf tiles use an ~8px artwork radius; 20px read as soap bubbles. */
const CARD_ART_RADIUS = 10;

/** Shared press wrapper: subtle scale-free fade keeps rails feeling calm. */
function CardPress({
  onPress,
  label,
  children,
  width,
}: {
  onPress: () => void;
  label: string;
  children: React.ReactNode;
  width: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ width, opacity: pressed ? 0.7 : 1 })}
    >
      {children}
    </Pressable>
  );
}

function CardCaption({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ marginTop: v2Spacing.xs }}>
      <V2Text variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>
        {title}
      </V2Text>
      {subtitle ? (
        <V2Text variant="small" color="textSecondary" numberOfLines={1}>
          {subtitle}
        </V2Text>
      ) : null}
    </View>
  );
}

/** Offline dot shown on cards whose content is saved to the device.
 *  Positioned with the logical `end` edge so RTL locales mirror it correctly. */
function OfflineDot() {
  return (
    <View
      style={{
        position: 'absolute',
        bottom: 8,
        end: 8,
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: 'rgba(0,0,0,0.65)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="checkmark" size={15} color={v2Colors.accent} />
    </View>
  );
}

export const V2TrackCard = memo(function V2TrackCard({
  track,
  onPress,
  width = CARD_WIDTH,
}: {
  track: CanonicalTrack;
  onPress: () => void;
  width?: number;
}) {
  const isDownloaded = useDownloadsStore((s) => s.downloadedIds.has(track.id));
  const artist = track.artists[0]?.name ?? 'Unknown artist';
  return (
    <CardPress onPress={onPress} label={`${track.title} by ${artist}`} width={width}>
      <View>
        <V2Artwork uri={track.artworkUrl} size={width} radius={CARD_ART_RADIUS} />
        {isDownloaded ? <OfflineDot /> : null}
      </View>
      <CardCaption title={track.title} subtitle={artist} />
    </CardPress>
  );
});

export const V2AlbumCard = memo(function V2AlbumCard({
  album,
  onPress,
  width = CARD_WIDTH,
}: {
  album: CanonicalAlbum;
  onPress: () => void;
  width?: number;
}) {
  return (
    <CardPress onPress={onPress} label={album.title} width={width}>
      <V2Artwork uri={album.artworkUrl} size={width} radius={CARD_ART_RADIUS} />
      <CardCaption title={album.title} subtitle={album.artist.name} />
    </CardPress>
  );
});

export const V2ArtistCard = memo(function V2ArtistCard({
  artist,
  onPress,
  width = 112,
}: {
  artist: CanonicalArtist;
  onPress: () => void;
  width?: number;
}) {
  return (
    <CardPress onPress={onPress} label={artist.name} width={width}>
      <View style={{ alignItems: 'center' }}>
        <V2Artwork uri={artist.artworkUrl} size={width} radius={width / 2} iconRatio={0.4} />
        <View style={{ marginTop: v2Spacing.xs, alignItems: 'center' }}>
          <V2Text
            variant="body"
            style={{ fontWeight: '600', textAlign: 'center' }}
            numberOfLines={1}
          >
            {artist.name}
          </V2Text>
          <V2Text variant="caption" color="textMuted">
            Artist
          </V2Text>
        </View>
      </View>
    </CardPress>
  );
});

export const V2PlaylistCard = memo(function V2PlaylistCard({
  playlist,
  onPress,
  width = CARD_WIDTH,
}: {
  playlist: CanonicalPlaylist;
  onPress: () => void;
  width?: number;
}) {
  return (
    <CardPress onPress={onPress} label={playlist.name} width={width}>
      <V2Artwork uri={playlist.artworkUrl} size={width} radius={CARD_ART_RADIUS} />
      <CardCaption title={playlist.name} subtitle={`${playlist.trackCount} songs`} />
    </CardPress>
  );
});

const MIX_GRADIENTS: Array<[string, string]> = [
  ['#1DB954', '#0E5C2A'],
  ['#7B5DD6', '#3A2A6E'],
  ['#0E7C86', '#083F45'],
  ['#E0245E', '#6E1030'],
];

function mixGradient(id: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return MIX_GRADIENTS[hash % MIX_GRADIENTS.length];
}

export const V2MixCard = memo(function V2MixCard({
  mix,
  onPress,
  width = CARD_WIDTH,
}: {
  mix: DailyMix;
  onPress: () => void;
  width?: number;
}) {
  const [from] = mixGradient(mix.id);
  return (
    <CardPress onPress={onPress} label={mix.name} width={width}>
      <View
        style={{
          width,
          height: width,
          borderRadius: CARD_ART_RADIUS,
          backgroundColor: from,
          padding: v2Spacing.sm,
          justifyContent: 'flex-end',
        }}
      >
        {/* Spotify "Made for you" tiles bottom-align a bold label. */}
        <V2Text variant="title" style={{ color: '#FFFFFF' }} numberOfLines={2}>
          {mix.name.replace(/^Made for you: /, '')}
        </V2Text>
        <V2Text variant="caption" style={{ color: '#FFFFFF', opacity: 0.8 }} numberOfLines={1}>
          Made for you
        </V2Text>
      </View>
      <CardCaption title={mix.name} subtitle={mix.description ?? mix.genre} />
    </CardPress>
  );
});

export const V2LocalPlaylistCard = memo(function V2LocalPlaylistCard({
  name,
  count,
  artworkUri,
  onPress,
  width = CARD_WIDTH,
}: {
  name: string;
  count: number;
  artworkUri?: string | null;
  onPress: () => void;
  width?: number;
}) {
  return (
    <CardPress onPress={onPress} label={name} width={width}>
      <V2Artwork uri={artworkUri} size={width} radius={CARD_ART_RADIUS} />
      <CardCaption title={name} subtitle={`${count} songs`} />
    </CardPress>
  );
});

export function v2LocalArtwork(tracks: CanonicalTrack[]): string | undefined {
  return playlistArtworkUrl(tracks);
}
