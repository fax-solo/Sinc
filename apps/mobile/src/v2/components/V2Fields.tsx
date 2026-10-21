import { forwardRef } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { v2Colors, v2Radii, v2Spacing } from '../theme';
import { V2Text } from './V2Text';

interface V2ChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

/** Pill filter chip — filled accent when active, elevated disc otherwise. */
export function V2Chip({ label, active, onPress }: V2ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({
        paddingHorizontal: v2Spacing.md,
        paddingVertical: 9,
        borderRadius: v2Radii.full,
        backgroundColor: active ? v2Colors.accent : v2Colors.surfaceElevated,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <V2Text
        variant="small"
        style={{ color: active ? v2Colors.onAccent : v2Colors.textSecondary, fontWeight: '700' }}
      >
        {label}
      </V2Text>
    </Pressable>
  );
}

interface V2SearchFieldProps extends TextInputProps {
  onClear?: () => void;
}

/** Rounded search input with a leading icon and a clear button. */
export const V2SearchField = forwardRef<TextInput, V2SearchFieldProps>(function V2SearchField(
  { onClear, value, ...rest },
  ref
) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: v2Colors.surfaceElevated,
        borderRadius: v2Radii.lg,
        paddingHorizontal: v2Spacing.md,
        gap: v2Spacing.sm,
      }}
    >
      <Ionicons name="search" size={20} color={v2Colors.textSecondary} />
      <TextInput
        ref={ref}
        value={value}
        placeholderTextColor={v2Colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        {...rest}
        style={{
          flex: 1,
          paddingVertical: 14,
          fontSize: 15,
          color: v2Colors.textPrimary,
        }}
      />
      {value && value.length > 0 && onClear ? (
        <Pressable onPress={onClear} hitSlop={10} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={20} color={v2Colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
});

type V2TextFieldProps = TextInputProps;

/** Single-line elevated input for names and links. */
export function V2TextField(props: V2TextFieldProps) {
  return (
    <TextInput
      placeholderTextColor={v2Colors.textMuted}
      autoCorrect={false}
      {...props}
      style={[
        {
          backgroundColor: v2Colors.surfaceElevated,
          borderRadius: v2Radii.md,
          paddingHorizontal: v2Spacing.md,
          paddingVertical: v2Spacing.sm,
          fontSize: 15,
          color: v2Colors.textPrimary,
        },
        props.style as object,
      ]}
    />
  );
}
