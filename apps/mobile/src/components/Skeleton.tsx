import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Pulsing placeholder block for skeleton loading states. Uses an opacity
 * pulse only (no layout shifts); color comes from surfaceContainerHigh.
 */
export function SkeletonBlock({
  width = '100%',
  height = 16,
  radius = 8,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const [opacity] = useState(() => new Animated.Value(0.55));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 520, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 520, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: tokens.colors.surfaceContainerHigh,
          opacity,
        },
        style,
      ]}
    />
  );
}

/** Row skeleton: artwork square + two text lines, matching list rows. */
export function SkeletonRow({ artSize = 44 }: { artSize?: number }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <SkeletonBlock width={artSize} height={artSize} radius={8} />
      <View style={styles.rowText}>
        <SkeletonBlock width="70%" height={16} />
        <SkeletonBlock width="40%" height={12} />
      </View>
    </View>
  );
}

/** Standard vertical list skeleton used by every detail screen header. */
export function DetailSkeleton(): React.JSX.Element {
  return (
    <View style={styles.detail}>
      <View style={styles.header}>
        <SkeletonBlock width={128} height={128} radius={16} />
        <View style={styles.headerText}>
          <SkeletonBlock width="85%" height={22} />
          <SkeletonBlock width="55%" height={14} />
          <SkeletonBlock width="65%" height={14} />
        </View>
      </View>
      <View style={styles.actions}>
        <SkeletonBlock width={104} height={40} radius={20} />
        <SkeletonBlock width={104} height={40} radius={20} />
        <SkeletonBlock width={104} height={40} radius={20} />
      </View>
      <View style={styles.list}>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  rowText: {
    flex: 1,
    gap: 6,
  },
  detail: {
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
    gap: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  list: {
    gap: 4,
  },
});
