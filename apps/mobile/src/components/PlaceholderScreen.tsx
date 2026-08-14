import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface ScreenProps {
  title: string;
  subtitle?: string;
}

/** Temporary placeholder shell used until each milestone implements its screens. */
export default function PlaceholderScreen({ title, subtitle }: ScreenProps): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <Text style={[tokens.typography.title1, { color: tokens.colors.onBackground }]}>{title}</Text>
      {subtitle ? (
        <Text style={[tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
});
