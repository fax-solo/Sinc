import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import AppButton from './AppButton';

/**
 * Shared error/empty state views for list and detail screens. Every screen
 * composes these so loading/empty/error/offline handling stays consistent.
 */
export function ErrorState({
  title,
  body,
  retryLabel,
  onRetry,
}: {
  title: string;
  body?: string;
  retryLabel?: string;
  onRetry?: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: tokens.colors.surfaceContainer }]}>
      <Text style={[tokens.typography.headline, { color: tokens.colors.error }]}>{title}</Text>
      {body ? (
        <Text style={[tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}>
          {body}
        </Text>
      ) : null}
      {retryLabel && onRetry ? <AppButton label={retryLabel} onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: tokens.colors.surfaceContainer }]}>
      <Text style={[tokens.typography.headline, { color: tokens.colors.onSurface }]}>{title}</Text>
      {body ? (
        <Text style={[tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 20,
    gap: 10,
    marginVertical: 16,
  },
});
