import type { ComponentProps } from 'react';
import { Text as RNText, type StyleProp, type TextStyle } from 'react-native';
import { colors, typography } from '../theme';

type Variant = keyof typeof typography;
type ColorName = keyof typeof colors;

interface TextProps extends Omit<ComponentProps<typeof RNText>, 'style'> {
  variant?: Variant;
  color?: ColorName;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
}

export function Text({
  variant = 'body',
  color,
  align,
  style,
  children,
  ...rest
}: TextProps) {
  return (
    <RNText
      {...rest}
      style={[
        typography[variant],
        color ? { color: colors[color] } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
    >
      {children}
    </RNText>
  );
}
