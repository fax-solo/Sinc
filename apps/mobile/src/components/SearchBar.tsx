import { Pressable, StyleSheet } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '../theme';

interface SearchBarProps {
  onPress: () => void;
}

export function SearchBar({ onPress }: SearchBarProps) {
  const { colors, radii, spacing } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="search"
      accessibilityLabel="Search songs, albums and artists"
      style={({ pressed }) => [
        styles.bar,
        {
          backgroundColor: colors.surfaceElevated,
          borderRadius: radii.full,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
        },
        pressed && styles.pressed,
      ]}
    >
      <AppText variant="body" color="textSecondary">
        Search songs, albums & artists
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'flex-start',
  },
  pressed: {
    opacity: 0.7,
  },
});
