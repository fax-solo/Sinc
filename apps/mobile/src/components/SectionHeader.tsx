import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/** Section title used on detail and list screens. */
export default function SectionHeader({ children }: { children: string }): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <Text style={[tokens.typography.headline, styles.title, { color: tokens.colors.onSurface }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: {
    marginTop: 16,
    marginBottom: 4,
  },
});
