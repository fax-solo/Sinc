import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { v2Colors, v2Radii, v2Spacing } from '../theme';
import { V2Text } from './V2Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface V2ButtonProps extends Omit<ComponentProps<typeof Pressable>, 'style' | 'children'> {
  variant?: Variant;
  label: string;
  loading?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function V2Button({
  variant = 'primary',
  label,
  loading = false,
  disabled,
  compact = false,
  style,
  ...rest
}: V2ButtonProps) {
  const background =
    variant === 'primary'
      ? v2Colors.accent
      : variant === 'danger'
        ? v2Colors.error
        : variant === 'secondary'
          ? v2Colors.surfaceElevated
          : 'transparent';

  const textColor =
    variant === 'primary' || variant === 'danger'
      ? v2Colors.onAccent
      : variant === 'secondary'
        ? v2Colors.textPrimary
        : v2Colors.accent;

  const isDisabled = disabled === true || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      {...rest}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background,
          paddingVertical: compact ? v2Spacing.xs : 14,
          paddingHorizontal: compact ? v2Spacing.md : v2Spacing.xl,
          borderRadius: v2Radii.full,
          opacity: isDisabled ? 0.45 : pressed ? 0.82 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <V2Text variant="body" style={{ color: textColor, fontWeight: '700' }}>
          {label}
        </V2Text>
      )}
    </Pressable>
  );
}
