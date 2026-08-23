import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { AppText } from './AppText';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends Omit<ComponentProps<typeof Pressable>, 'style' | 'children'> {
  variant?: Variant;
  label: string;
  loading?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AppButton({
  variant = 'primary',
  label,
  loading = false,
  disabled,
  compact = false,
  style,
  ...rest
}: ButtonProps) {
  const { colors, spacing, radii } = useTheme();

  const background =
    variant === 'primary'
      ? colors.accent
      : variant === 'danger'
        ? colors.error
        : variant === 'secondary'
          ? colors.surfaceElevated
          : 'transparent';

  const textColor =
    variant === 'primary'
      ? colors.onAccent
      : variant === 'danger'
        ? colors.onAccent
        : variant === 'secondary'
          ? colors.textPrimary
          : colors.accent;

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
          paddingVertical: compact ? spacing.xs : spacing.sm,
          paddingHorizontal: compact ? spacing.sm : spacing.lg,
          borderRadius: radii.md,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <AppText variant="bodyLarge" style={{ color: textColor }}>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}
