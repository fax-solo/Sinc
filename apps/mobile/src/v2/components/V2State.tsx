import { ActivityIndicator, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { v2Colors, v2Radii, v2Spacing } from '../theme';
import { V2Text } from './V2Text';
import { V2Button } from './V2Button';

interface V2EmptyProps {
  icon?: string;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Friendly empty state: soft icon disc, bold title, muted hint, pill action. */
export function V2Empty({
  icon = 'musical-notes',
  title,
  hint,
  actionLabel,
  onAction,
}: V2EmptyProps) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: v2Spacing.xxxl, gap: v2Spacing.sm }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: v2Colors.surfaceElevated,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon as never} size={30} color={v2Colors.textMuted} />
      </View>
      <V2Text variant="headline" style={{ textAlign: 'center' }}>
        {title}
      </V2Text>
      {hint ? (
        <V2Text variant="body" color="textSecondary" style={{ textAlign: 'center', maxWidth: 280 }}>
          {hint}
        </V2Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: v2Spacing.xs }}>
          <V2Button label={actionLabel} onPress={onAction} compact />
        </View>
      ) : null}
    </View>
  );
}

/** Centered loading spinner with an optional label. */
export function V2Loading({ label }: { label?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: v2Spacing.xxxl, gap: v2Spacing.sm }}>
      <ActivityIndicator size="large" color={v2Colors.accent} />
      {label ? (
        <V2Text variant="small" color="textSecondary">
          {label}
        </V2Text>
      ) : null}
    </View>
  );
}

interface V2ErrorProps {
  message: string;
  onRetry?: () => void;
}

export function V2Error({ message, onRetry }: V2ErrorProps) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: v2Spacing.xxxl, gap: v2Spacing.sm }}>
      <V2Text variant="body" color="error" style={{ textAlign: 'center' }}>
        {message}
      </V2Text>
      {onRetry ? <V2Button label="Retry" onPress={onRetry} compact /> : null}
    </View>
  );
}

/** Static skeleton blocks shown while rails load. */
export function V2SkeletonRail({
  count = 3,
  cardWidth = 148,
}: {
  count?: number;
  cardWidth?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: v2Spacing.md }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width: cardWidth }}>
          <View
            style={{
              width: cardWidth,
              height: cardWidth,
              borderRadius: v2Radii.lg,
              backgroundColor: v2Colors.surfaceElevated,
            }}
          />
          <View
            style={{
              marginTop: v2Spacing.xs,
              height: 12,
              borderRadius: 6,
              width: '80%',
              backgroundColor: v2Colors.surfaceElevated,
            }}
          />
        </View>
      ))}
    </View>
  );
}
