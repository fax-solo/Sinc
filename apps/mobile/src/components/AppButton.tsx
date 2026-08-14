import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
}

export default function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: ButtonProps): React.JSX.Element {
  const { tokens } = useTheme();
  const isPrimary = variant === 'primary';
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.base,
        {
          backgroundColor: isPrimary ? tokens.colors.primary : tokens.colors.surfaceContainer,
          opacity: disabled ? tokens.opacity.disabled : 1,
        },
      ]}
    >
      <Text
        style={[
          tokens.typography.headline,
          { color: isPrimary ? tokens.colors.onPrimary : tokens.colors.onSurface },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
});
