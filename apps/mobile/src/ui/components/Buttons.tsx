import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, radii, spacing } from '../theme';
import { Text } from './Text';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface IconButtonProps {
  icon: IconName;
  onPress: () => void;
  label: string;
  size?: number;
  iconSize?: number;
  color?: string;
  background?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon,
  onPress,
  label,
  size = 42,
  iconSize,
  color = colors.text,
  background = 'transparent',
  disabled,
  style,
}: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background,
          opacity: disabled ? 0.4 : pressed ? 0.68 : 1,
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={iconSize ?? Math.round(size * 0.52)} color={color} />
    </Pressable>
  );
}

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function PrimaryButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  loading,
  disabled,
  compact,
  style,
  accessibilityLabel,
}: PrimaryButtonProps) {
  const background =
    variant === 'primary'
      ? colors.accent
      : variant === 'danger'
        ? colors.error
        : variant === 'secondary'
          ? colors.card
          : 'transparent';
  const foreground =
    variant === 'primary' ? colors.onAccent : variant === 'danger' ? colors.white : colors.text;
  const isDisabled = Boolean(disabled || loading);

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: Boolean(loading) }}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          minHeight: compact ? 36 : 48,
          paddingHorizontal: compact ? 14 : 22,
          borderRadius: radii.full,
          backgroundColor: background,
          opacity: isDisabled ? 0.42 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={compact ? 16 : 19} color={foreground} /> : null}
          <Text
            variant={compact ? 'small' : 'bodyLarge'}
            style={{ color: foreground, fontWeight: '700' }}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

interface TextButtonProps {
  label: string;
  onPress: () => void;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export function TextButton({ label, onPress, color = colors.accent, style }: TextButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }, style]}
    >
      <Text variant="small" style={{ color, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function RoundPlayButton({
  playing,
  loading,
  onPress,
  size = 54,
  label,
}: {
  playing: boolean;
  loading?: boolean;
  onPress: (event: GestureResponderEvent) => void;
  size?: number;
  label?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? (playing ? 'Pause' : 'Play')}
      hitSlop={6}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={colors.onAccent} />
      ) : (
        <Ionicons
          name={playing ? 'pause' : 'play'}
          size={Math.round(size * 0.42)}
          color={colors.onAccent}
          style={playing ? undefined : { marginLeft: Math.round(size * 0.04) }}
        />
      )}
    </Pressable>
  );
}

export function IconBadge({
  children,
  top = -2,
  right = -2,
}: {
  children: ReactNode;
  top?: number;
  right?: number;
}) {
  return (
    <Pressable
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: 'absolute',
        top,
        right,
        minWidth: 17,
        height: 17,
        borderRadius: 9,
        paddingHorizontal: 4,
        backgroundColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </Pressable>
  );
}

export const buttonHitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const rowGap = spacing.sm;
