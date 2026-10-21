import { Pressable, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { v2Colors, v2Spacing } from '../theme';
import { V2Text } from './V2Text';
import { V2Artwork } from './V2Artwork';
import { playerService } from '../../services/player/PlayerService';
import { selectCurrentTrack, usePlayerStore } from '../../services/player/playerStore';
import { usePlayerProgressStore } from '../../services/player/playerProgressStore';
import { useLibraryStore } from '../../services/library/libraryStore';
import type { RootStackParamList } from '../../app/navigation/types';

/**
 * Spotify-style mini player docked above the tab bar: a green progress
 * hairline along the TOP edge of the bar, artwork, titles, then a heart and
 * a play/pause disc. Tapping the body opens Now Playing.
 */
export function V2MiniPlayer() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const track = usePlayerStore(selectCurrentTrack);
  const status = usePlayerStore((s) => s.status);
  const positionMs = usePlayerProgressStore((s) => s.positionMs);
  const durationMs = usePlayerProgressStore((s) => s.durationMs);
  const isFavorite = useLibraryStore((s) => (track ? s.favoriteIds.has(track.id) : false));
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);

  if (!track) return null;

  // Hairline render window is wide enough to look continuous between ticks.
  const percent = Math.round(progressPct(positionMs, durationMs, track) * 100);
  const playing = status === 'playing';

  return (
    <View style={{ backgroundColor: v2Colors.surface }}>
      {/* Green hairline on the TOP edge — the signature Spotify detail. */}
      <View style={{ height: 2, backgroundColor: v2Colors.surfaceElevated }}>
        <View
          style={{
            height: 2,
            width: `${percent}%`,
            backgroundColor: v2Colors.accent,
          }}
        />
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: v2Spacing.sm,
          paddingHorizontal: v2Spacing.md,
          paddingVertical: v2Spacing.xs,
        }}
      >
        <PressableOpen
          onPress={() => navigation.navigate('Player')}
          label={`Now playing ${track.title}`}
        >
          <V2Artwork uri={track.artworkUrl} size={44} />
          <View style={{ flex: 1 }}>
            <V2Text variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>
              {track.title}
            </V2Text>
            <V2Text variant="small" color="textSecondary" numberOfLines={1}>
              {track.artists.map((a) => a.name).join(', ')}
            </V2Text>
          </View>
        </PressableOpen>
        <Pressable
          onPress={() => toggleFavorite(track)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={isFavorite ? 'Unlike' : 'Like'}
          style={{ padding: v2Spacing.xs }}
        >
          <Ionicons
            name={isFavorite ? 'heart' : 'heart-outline'}
            size={22}
            color={isFavorite ? v2Colors.accent : v2Colors.textSecondary}
          />
        </Pressable>
        <Pressable
          onPress={() => void playerService.togglePlayPause()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause' : 'Play'}
          style={({ pressed }) => ({
            width: 42,
            height: 42,
            borderRadius: 21,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.8 : 1,
          })}
        >
          {/* Text-white disc like the Spotify mini player. */}
          <Ionicons
            name={playing ? 'pause' : 'play'}
            size={26}
            color={v2Colors.textPrimary}
            style={playing ? undefined : { marginLeft: 2 }}
          />
        </Pressable>
      </View>
    </View>
  );
}

function progressPct(
  positionMs: number,
  durationMs: number,
  track: { durationMs?: number }
): number {
  const total = durationMs > 0 ? durationMs : (track.durationMs ?? 0);
  return total > 0 ? Math.min(positionMs / total, 1) : 0;
}

function PressableOpen({
  onPress,
  label,
  children,
}: {
  onPress: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: v2Spacing.sm,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}
