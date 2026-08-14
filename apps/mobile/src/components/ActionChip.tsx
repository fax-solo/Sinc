import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/** Compact pill button used for detail screen action rows. */
export default function ActionChip({
  label,
  onPress,
  disabled = false,
  prominent = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  prominent?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: prominent ? tokens.colors.primary : tokens.colors.surfaceContainerHigh,
          opacity: disabled ? tokens.opacity.disabled : 1,
        },
      ]}
    >
      <Text
        style={[
          tokens.typography.callout,
          { color: prominent ? tokens.colors.onPrimary : tokens.colors.onSurface },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 40,
    borderRadius: 999,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
