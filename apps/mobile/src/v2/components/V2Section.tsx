import type { ReactNode } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { v2Spacing } from '../theme';
import { V2Text } from './V2Text';

interface V2SectionProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}

/** Bold section title with an optional trailing action, wrapping any content. */
export function V2Section({ title, subtitle, actionLabel, onAction, children }: V2SectionProps) {
  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: v2Spacing.sm,
        }}
      >
        <View style={{ flex: 1 }}>
          <V2Text variant="title">{title}</V2Text>
          {subtitle ? (
            <V2Text variant="small" color="textSecondary" style={{ marginTop: 2 }}>
              {subtitle}
            </V2Text>
          ) : null}
        </View>
        {actionLabel && onAction ? (
          <Pressable onPress={onAction} hitSlop={8}>
            <V2Text variant="small" color="accent" style={{ fontWeight: '700' }}>
              {actionLabel}
            </V2Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

interface V2RailProps<T> {
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T, index: number) => React.ReactElement;
}

/** Horizontal snap-free rail with comfortable card spacing.
 *  No removeClippedSubviews: it blurs cards that are half-clipped on Android
 *  mid-scroll and these rails are short enough to skip the optimization. */
export function V2Rail<T>({ items, keyOf, renderItem }: V2RailProps<T>) {
  return (
    <FlatList
      data={items}
      keyExtractor={keyOf}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: v2Spacing.md, paddingRight: v2Spacing.md }}
      renderItem={({ item, index }) => renderItem(item, index)}
      initialNumToRender={4}
      maxToRenderPerBatch={4}
      windowSize={5}
    />
  );
}
