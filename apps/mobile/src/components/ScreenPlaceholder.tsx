import { View } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '../theme';

interface ScreenPlaceholderProps {
  title: string;
  description: string;
}

export function ScreenPlaceholder({ title, description }: ScreenPlaceholderProps) {
  const { spacing } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
      <AppText variant="headline">{title}</AppText>
      <View style={{ marginTop: spacing.sm }}>
        <AppText variant="body" color="textSecondary" style={{ textAlign: 'center' }}>
          {description}
        </AppText>
      </View>
    </View>
  );
}
