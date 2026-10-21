import type { ComponentProps, ReactNode } from 'react';
import { Text as RNText, type TextStyle } from 'react-native';
import { v2Colors, type V2ColorName, type V2TextVariant } from '../theme';

interface V2TextProps extends Omit<ComponentProps<typeof RNText>, 'style'> {
  variant?: V2TextVariant;
  color?: V2ColorName;
  style?: TextStyle | TextStyle[];
  children: ReactNode;
}

const variantStyle: Record<
  V2TextVariant,
  Pick<TextStyle, 'fontSize' | 'fontWeight' | 'lineHeight'>
> = {
  display: { fontSize: 30, fontWeight: '800', lineHeight: 36 },
  title: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  headline: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 21 },
  small: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
};

export function V2Text({
  variant = 'body',
  color = 'textPrimary',
  style,
  children,
  ...rest
}: V2TextProps) {
  return (
    <RNText {...rest} style={[variantStyle[variant], { color: v2Colors[color] }, style]}>
      {children}
    </RNText>
  );
}
