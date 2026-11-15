import { memo, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { CanonicalTrack } from '@sinc/shared';
import { colors, radii, spacing } from '../theme';
import { Text } from './Text';
import { Artwork } from './Artwork';
import { formatDuration } from '../../utils/format';

interface SongRowProps {
  track: CanonicalTrack;
  onPress: () => void;
  onMore?: () => void;
  onLongPress?: () => void;
  subtitle?: string;
  isCurrent?: boolean;
  isPlaying?: boolean;
  downloaded?: boolean;
  showIndex?: number;
  showDuration?: boolean;
  trailing?: ReactNode;
  compact?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
}

/** A roomy, virtualisation-friendly song row with artwork and one trailing menu. */
export const SongRow = memo(function SongRow({
  track,
  onPress,
  onMore,
  onLongPress,
  subtitle,
  isCurrent,
  isPlaying,
  downloaded,
  showIndex,
  showDuration = true,
  trailing,
  compact,
  selectionMode,
  selected,
}: SongRowProps) {
  const artistLine =
    subtitle || track.artists.map((artist) => artist.name).join(', ') || 'Unknown artist';
  const artSize = compact ? 44 : 52;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress ?? onMore}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${track.title} by ${artistLine}${
        selected ? ', selected' : isCurrent ? ', currently playing' : ''
      }`}
      accessibilityState={selectionMode ? { selected: Boolean(selected) } : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        marginHorizontal: -6,
        paddingVertical: compact ? 7 : 8,
        paddingHorizontal: 6,
        borderRadius: radii.sm,
        backgroundColor: selectionMode && selected ? colors.accentSoft : 'transparent',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {typeof showIndex === 'number' ? (
        <View style={{ width: 22, alignItems: 'center' }}>
          {isCurrent && isPlaying ? (
            <Ionicons name="volume-high" size={16} color={colors.accent} />
          ) : (
            <Text variant="small" color={isCurrent ? 'accent' : 'textMuted'}>
              {showIndex}
            </Text>
          )}
        </View>
      ) : null}

      <View>
        <Artwork
          uri={track.artworkUrl}
          size={artSize}
          radius={radii.xs + 2}
          accessibilityLabel={`${track.title} artwork`}
        />
        {isCurrent ? (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: radii.xs + 2,
              backgroundColor: 'rgba(4, 12, 8, 0.48)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name={isPlaying ? 'volume-high' : 'pause'}
              size={compact ? 16 : 18}
              color={colors.accent}
            />
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text
          variant="bodyStrong"
          numberOfLines={1}
          style={{ color: isCurrent ? colors.accent : colors.text }}
        >
          {track.title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          {track.explicit ? (
            <View
              style={{
                paddingHorizontal: 4,
                borderRadius: 3,
                backgroundColor: colors.textMuted,
              }}
            >
              <Text
                style={{ fontSize: 8, lineHeight: 11, color: colors.background, fontWeight: '800' }}
              >
                E
              </Text>
            </View>
          ) : null}
          <Text variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
            {artistLine}
          </Text>
          {downloaded ? <Ionicons name="checkmark-circle" size={14} color={colors.accent} /> : null}
        </View>
      </View>

      {selectionMode ? (
        <View style={{ width: 32, alignItems: 'center' }}>
          <Ionicons
            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
            size={24}
            color={selected ? colors.accent : colors.textMuted}
          />
        </View>
      ) : (
        <>
          {trailing}

          {showDuration ? (
            <Text variant="caption" style={{ minWidth: 32, textAlign: 'right' }}>
              {track.durationMs > 0 ? formatDuration(track.durationMs) : '--:--'}
            </Text>
          ) : null}

          {onMore ? (
            <Pressable
              onPress={(event) => {
                event.stopPropagation();
                onMore();
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`More options for ${track.title}`}
              style={({ pressed }) => ({
                width: 28,
                height: 34,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.55 : 1,
              })}
            >
              <Ionicons name="ellipsis-vertical" size={17} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </>
      )}
    </Pressable>
  );
});
