import type { ReactNode } from 'react';
import {
  ScrollView,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, pageGutter, spacing } from '../theme';
import { Text } from './Text';
import { IconButton } from './Buttons';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  topInset?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollProps?: Omit<ScrollViewProps, 'contentContainerStyle' | 'children'>;
}

export function Screen({
  children,
  scroll = false,
  padded = true,
  topInset = true,
  style,
  contentContainerStyle,
  scrollProps,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const paddingTop = topInset ? insets.top + spacing.xs : 0;
  const paddingHorizontal = padded ? pageGutter : 0;

  if (scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: colors.background }, style]}>
        <ScrollView
          {...scrollProps}
          contentContainerStyle={[
            {
              paddingTop,
              paddingHorizontal,
              paddingBottom: spacing.xxxl,
            },
            contentContainerStyle,
          ]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      style={[
        { flex: 1, backgroundColor: colors.background, paddingTop, paddingHorizontal },
        style,
      ]}
    >
      {children}
    </View>
  );
}

interface HeaderProps {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  transparent?: boolean;
  large?: boolean;
}

export function Header({ title, subtitle, onBack, right, transparent, large }: HeaderProps) {
  return (
    <View
      style={{
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.xs,
        backgroundColor: transparent ? 'transparent' : colors.background,
        gap: spacing.sm,
      }}
    >
      {onBack ? (
        <IconButton
          icon="chevron-back"
          label="Back"
          size={38}
          background={colors.card}
          onPress={onBack}
        />
      ) : null}
      <View style={{ flex: 1, alignItems: onBack ? 'center' : 'flex-start' }}>
        {title ? (
          <Text variant={large ? 'title' : 'headline'} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text variant="caption" numberOfLines={1} style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={{ minWidth: onBack ? 38 : 0, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: spacing.md,
        marginBottom: spacing.sm,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="headline">{title}</Text>
        {subtitle ? (
          <Text variant="small" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Text
          accessibilityRole="button"
          onPress={onAction}
          variant="small"
          style={{ color: colors.accent, fontWeight: '700' }}
        >
          {actionLabel}
        </Text>
      ) : null}
    </View>
  );
}

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <IconButton
      icon="chevron-back"
      label="Back"
      size={38}
      background={colors.card}
      onPress={onPress}
    />
  );
}

export function ChevronDownButton({ onPress }: { onPress: () => void }) {
  return (
    <IconButton
      icon="chevron-down"
      label="Close player"
      size={40}
      background={colors.card}
      onPress={onPress}
    />
  );
}

export function ScreenTitle({
  eyebrow,
  title,
  right,
}: {
  eyebrow?: string;
  title: string;
  right?: ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingTop: spacing.sm,
        marginBottom: spacing.lg,
      }}
    >
      <View style={{ flex: 1 }}>
        {eyebrow ? (
          <Text variant="micro" style={{ marginBottom: 4 }}>
            {eyebrow}
          </Text>
        ) : null}
        <Text variant="display" numberOfLines={1}>
          {title}
        </Text>
      </View>
      {right}
    </View>
  );
}

export const ScreenSpacer = ({ size = spacing.lg }: { size?: number }) => (
  <View style={{ height: size }} />
);

export const ChevronIcon = ({ direction = 'forward' }: { direction?: 'forward' | 'back' }) => (
  <Ionicons
    name={direction === 'back' ? 'chevron-back' : 'chevron-forward'}
    size={18}
    color={colors.textMuted}
  />
);
