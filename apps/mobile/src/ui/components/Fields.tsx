import { forwardRef } from 'react';
import {
  Pressable,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, radii, spacing } from '../theme';
import { Text } from './Text';

interface SearchInputProps extends Omit<TextInputProps, 'style'> {
  value: string;
  onChangeText: (value: string) => void;
  onClear?: () => void;
  containerStyle?: StyleProp<ViewStyle>;
  autoFocus?: boolean;
}

export const SearchInput = forwardRef<TextInput, SearchInputProps>(function SearchInput(
  { value, onChangeText, onClear, containerStyle, autoFocus, ...rest },
  ref
) {
  return (
    <View
      style={[
        {
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          borderRadius: radii.md,
          backgroundColor: colors.input,
          borderWidth: 1,
          borderColor: colors.borderSoft,
        },
        containerStyle,
      ]}
    >
      <Ionicons name="search" size={19} color={colors.textSecondary} />
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        autoFocus={autoFocus}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        accessibilityLabel="Search"
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        style={{
          flex: 1,
          color: colors.text,
          fontFamily: 'sans-serif',
          fontSize: 15,
          paddingVertical: 12,
        }}
        {...rest}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => {
            onChangeText('');
            onClear?.();
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Ionicons name="close-circle" size={18} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
});

interface FilterChipProps {
  label: string;
  active?: boolean;
  onPress: () => void;
  count?: number;
}

export function FilterChip({ label, active, onPress, count }: FilterChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 14,
        minHeight: 34,
        borderRadius: radii.full,
        backgroundColor: active ? colors.accent : colors.card,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Text
        variant="small"
        style={{
          color: active ? colors.onAccent : colors.textSecondary,
          fontWeight: '700',
        }}
      >
        {label}
      </Text>
      {typeof count === 'number' ? (
        <Text
          variant="caption"
          style={{ color: active ? colors.onAccent : colors.textMuted, fontWeight: '700' }}
        >
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

interface FieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  hint?: string;
  error?: string | null;
  multiline?: boolean;
}

export function Field({ label, hint, error, multiline, ...rest }: FieldProps) {
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text variant="micro" style={{ color: colors.textSecondary }}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        multiline={multiline}
        style={{
          minHeight: multiline ? 96 : 48,
          borderRadius: radii.md,
          backgroundColor: colors.input,
          borderWidth: 1,
          borderColor: error ? colors.error : colors.borderSoft,
          color: colors.text,
          paddingHorizontal: 14,
          paddingVertical: multiline ? 12 : 0,
          fontFamily: 'sans-serif',
          fontSize: 15,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
        {...rest}
      />
      {error ? (
        <Text variant="caption" style={{ color: colors.error }}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption">{hint}</Text>
      ) : null}
    </View>
  );
}
