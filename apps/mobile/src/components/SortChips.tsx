import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/** Horizontal sort/filter chip row; single-select. */
export default function SortChips<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: readonly { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <TouchableOpacity
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(option.value)}
            style={[
              styles.chip,
              {
                backgroundColor: active
                  ? tokens.colors.primary
                  : tokens.colors.surfaceContainerHigh,
              },
            ]}
          >
            <Text
              style={[
                tokens.typography.caption,
                { color: active ? tokens.colors.onPrimary : tokens.colors.onSurfaceVariant },
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 8,
    paddingVertical: 4,
  },
  chip: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
});
