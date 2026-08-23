import type { ComponentProps } from 'react';
import { Pressable } from 'react-native';
import { useTheme } from '../theme';
import { AppText } from './AppText';

interface AppTextLinkProps extends Omit<ComponentProps<typeof Pressable>, 'style' | 'children'> {
  label: string;
}

export function AppTextLink({ label, ...rest }: AppTextLinkProps) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" hitSlop={8} {...rest}>
      <AppText variant="body" style={{ color: colors.accent }}>
        {label}
      </AppText>
    </Pressable>
  );
}
