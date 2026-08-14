import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/** Generic library row: monogram square + title + subtitle + optional chevron. */
export default function SimpleRow({
  title,
  subtitle,
  monogram,
  onPress,
  disabled,
}: {
  title: string;
  subtitle?: string;
  monogram?: string;
  onPress?: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const body = (
    <>
      <View style={[styles.monogram, { backgroundColor: tokens.colors.surfaceContainerHigh }]}>
        <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
          {(monogram ?? title ?? '?').slice(0, 1)}
        </Text>
      </View>
      <View style={styles.texts}>
        <Text
          numberOfLines={1}
          style={[
            tokens.typography.body,
            { color: disabled ? tokens.colors.onSurfaceVariant : tokens.colors.onBackground },
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onPress && !disabled ? (
        <Text style={[tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}>
          {'\u203A'}
        </Text>
      ) : null}
    </>
  );
  if (disabled || !onPress) {
    return (
      <View style={[styles.row, { opacity: 0.6 }]} accessibilityLabel={title}>
        {body}
      </View>
    );
  }
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={styles.row}
    >
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  monogram: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
  },
});
