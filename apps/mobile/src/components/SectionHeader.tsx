import { View } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '../theme';

interface SectionHeaderProps {
  title: string;
  action?: { label: string; onPress: () => void };
}

export function SectionHeader({ title, action }: SectionHeaderProps) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <AppText variant="headline">{title}</AppText>
      {action ? (
        <AppText
          variant="body"
          color="accent"
          style={{ marginLeft: spacing.sm }}
          suppressHighlighting
          onPress={action.onPress}
        >
          {action.label}
        </AppText>
      ) : null}
    </View>
  );
}
