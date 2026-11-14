import { useEffect, useState } from 'react';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Animated, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, radii, spacing } from '../theme';
import { PrimaryButton } from './Buttons';
import { Text } from './Text';

export function Loading({ label }: { label?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
      <ActivityIndicator color={colors.accent} size="large" />
      {label ? <Text variant="small">{label}</Text> : null}
    </View>
  );
}

export function SkeletonBlock({
  height,
  width = '100%',
  radius = 10,
}: {
  height: number;
  width?: number | `${number}%`;
  radius?: number;
}) {
  const [opacity] = useState(() => new Animated.Value(0.42));

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.78, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.42, duration: 750, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{
        height,
        width,
        borderRadius: radius,
        backgroundColor: colors.card,
        opacity,
      }}
    />
  );
}

export function HomeSkeleton() {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: spacing.xl }}>
      <View style={{ gap: 8 }}>
        <SkeletonBlock height={14} width="42%" />
        <SkeletonBlock height={32} width="66%" />
      </View>
      <SkeletonBlock height={176} radius={radii.xl} />
      <View style={{ gap: spacing.sm }}>
        <SkeletonBlock height={20} width="36%" />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <SkeletonBlock height={176} width={150} />
          <SkeletonBlock height={176} width={150} />
        </View>
      </View>
      <View style={{ gap: spacing.sm }}>
        <SkeletonBlock height={20} width="42%" />
        <ListSkeleton rows={3} />
      </View>
    </View>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <SkeletonBlock height={52} width={52} radius={8} />
          <View style={{ flex: 1, gap: 7 }}>
            <SkeletonBlock height={13} width="72%" />
            <SkeletonBlock height={11} width="44%" />
          </View>
        </View>
      ))}
    </View>
  );
}

export function EmptyState({
  icon = 'musical-notes-outline',
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon?: ComponentProps<typeof Ionicons>['name'];
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.huge,
        paddingHorizontal: spacing.lg,
        gap: spacing.sm,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.card,
          marginBottom: spacing.xs,
        }}
      >
        <Ionicons name={icon} size={30} color={colors.textMuted} />
      </View>
      <Text variant="headline" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="small" align="center" style={{ maxWidth: 300, lineHeight: 19 }}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <PrimaryButton
          label={actionLabel}
          onPress={onAction}
          compact
          style={{ marginTop: spacing.sm }}
        />
      ) : null}
    </View>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'The request could not be completed. Check your connection and try again.',
  onRetry,
  compact = false,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: compact ? spacing.xl : spacing.huge,
        paddingHorizontal: spacing.lg,
      }}
    >
      <View
        style={{
          width: compact ? 48 : 64,
          height: compact ? 48 : 64,
          borderRadius: compact ? 24 : 32,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(255, 91, 101, 0.12)',
        }}
      >
        <Ionicons name="warning-outline" size={compact ? 22 : 28} color={colors.error} />
      </View>
      <Text variant="bodyStrong" align="center">
        {title}
      </Text>
      <Text variant="small" align="center" style={{ maxWidth: 320 }}>
        {message}
      </Text>
      {onRetry ? (
        <PrimaryButton
          label="Try again"
          onPress={onRetry}
          variant="secondary"
          compact
          style={{ marginTop: spacing.xs }}
        />
      ) : null}
    </View>
  );
}

export function SectionError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <ErrorState compact title="Could not load this section" message={message} onRetry={onRetry} />;
}

export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'accent' | 'error';
}) {
  const background =
    tone === 'accent'
      ? colors.accentSoft
      : tone === 'error'
        ? 'rgba(255, 91, 101, 0.13)'
        : colors.card;
  const color =
    tone === 'accent' ? colors.accentBright : tone === 'error' ? colors.error : colors.textSecondary;
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radii.full,
        backgroundColor: background,
      }}
    >
      <Text variant="micro" style={{ color, fontSize: 9 }}>
        {label}
      </Text>
    </View>
  );
}
