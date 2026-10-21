import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { v2Colors, v2Spacing } from '../theme';

interface V2ScreenProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  topInset?: boolean;
}

/** Full-bleed background + safe-area aware container shared by all v2 screens. */
export function V2Screen({ children, style, padded = true, topInset = true }: V2ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: v2Colors.background,
          paddingTop: topInset ? insets.top + v2Spacing.sm : 0,
          paddingHorizontal: padded ? v2Spacing.md : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
