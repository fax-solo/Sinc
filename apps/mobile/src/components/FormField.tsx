import React from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface FormFieldProps extends TextInputProps {
  label: string;
  error?: string;
}

export default function FormField({
  label,
  error,
  style,
  ...inputProps
}: FormFieldProps): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
        {label}
      </Text>
      <TextInput
        {...inputProps}
        style={[
          styles.input,
          tokens.typography.body,
          {
            color: tokens.colors.onSurface,
            backgroundColor: tokens.colors.surfaceContainer,
            borderColor: error ? tokens.colors.error : 'transparent',
          },
          style,
        ]}
        placeholderTextColor={tokens.colors.onSurfaceVariant}
      />
      {error ? (
        <Text style={[tokens.typography.caption, { color: tokens.colors.error }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 6,
  },
  input: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
});
