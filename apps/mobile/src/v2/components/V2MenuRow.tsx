import { Pressable, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { v2Colors, v2Radii, v2Spacing } from '../theme';
import { V2Text } from './V2Text';
import { chevronIcon } from '../../utils/rtl';

interface V2MenuRowProps {
  icon: string;
  iconColor?: string;
  title: string;
  subtitle?: string;
  badge?: string;
  onPress: () => void;
}

/** Settings/library menu row: soft tinted tile, two-line label, chevron. */
export function V2MenuRow({
  icon,
  iconColor = v2Colors.accent,
  title,
  subtitle,
  badge,
  onPress,
}: V2MenuRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: v2Spacing.md,
        backgroundColor: v2Colors.surface,
        borderRadius: v2Radii.lg,
        padding: v2Spacing.sm,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: v2Radii.md,
          backgroundColor: v2Colors.surfaceElevated,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon as never} size={22} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <V2Text variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>
          {title}
        </V2Text>
        {subtitle ? (
          <V2Text variant="small" color="textSecondary" numberOfLines={1}>
            {subtitle}
          </V2Text>
        ) : null}
      </View>
      {badge ? (
        <View
          style={{
            backgroundColor: v2Colors.accentMuted,
            borderRadius: v2Radii.full,
            paddingHorizontal: 10,
            paddingVertical: 4,
          }}
        >
          <V2Text variant="caption" color="accent" style={{ fontWeight: '700' }}>
            {badge}
          </V2Text>
        </View>
      ) : (
        <Ionicons name={chevronIcon('forward')} size={18} color={v2Colors.textMuted} />
      )}
    </Pressable>
  );
}
