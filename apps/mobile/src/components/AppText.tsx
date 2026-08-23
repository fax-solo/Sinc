import type { ComponentProps, ReactNode } from 'react';
import { Text as RNText, type TextStyle } from 'react-native';
import { useTheme } from '../theme';

type Variant = 'display' | 'title' | 'headline' | 'bodyLarge' | 'body' | 'small' | 'caption';

type ColorName =
  | 'textPrimary'
  | 'textSecondary'
  | 'textMuted'
  | 'accent'
  | 'onAccent'
  | 'error'
  | 'success'
  | 'warning';

interface AppTextProps extends Omit<ComponentProps<typeof RNText>, 'style'> {
  variant?: Variant;
  color?: ColorName;
  style?: TextStyle | TextStyle[];
  children: ReactNode;
}
const variantStyle: Record<Variant, Pick<TextStyle, 'fontSize' | 'fontWeight' | 'lineHeight'>> = {
  display: { fontSize: 28, fontWeight: '800', lineHeight: 34 },
  title: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  headline: { fontSize: 18, fontWeight: '700', lineHeight: 24 },
  bodyLarge: { fontSize: 16, fontWeight: '500', lineHeight: 22 },
  body: { fontSize: 14, fontWeight: '400', lineHeight: 20 },
  small: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '400', lineHeight: 16 },
};

export function AppText({
  variant = 'body',
  color = 'textPrimary',
  style,
  children,
  ...rest
}: AppTextProps) {
  const { colors } = useTheme();
  return (
    <RNText {...rest} style={[variantStyle[variant], { color: colors[color] }, style]}>
      {children}
    </RNText>
  );
}
