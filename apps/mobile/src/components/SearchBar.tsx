import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/** Local library search input with a clear affordance. */
export default function SearchBar({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: tokens.colors.surfaceContainerHigh }]}>
      <TextInput
        style={[styles.input, tokens.typography.body, { color: tokens.colors.onBackground }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={tokens.colors.onSurfaceVariant}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          style={styles.clear}
        >
          <Text style={[tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}>
            {'\u2715'}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
  },
  clear: {
    padding: 6,
  },
});
