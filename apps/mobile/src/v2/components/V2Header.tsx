import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { v2Colors } from '../theme';
import { V2Text } from './V2Text';
import { chevronIcon } from '../../utils/rtl';

interface V2HeaderProps {
  title: string;
  subtitle?: string;
  onBack: () => void;
  right?: ReactNode;
}

/** Centered-title bar with a round back button, used by every v2 sub-view. */
export function V2Header({ title, subtitle, onBack, right }: V2HeaderProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
      <Pressable
        onPress={onBack}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: v2Colors.surfaceElevated,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons name={chevronIcon('back')} size={22} color={v2Colors.textPrimary} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 8 }}>
        <V2Text variant="headline" numberOfLines={1}>
          {title}
        </V2Text>
        {subtitle ? (
          <V2Text variant="caption" color="textSecondary" numberOfLines={1}>
            {subtitle}
          </V2Text>
        ) : null}
      </View>
      <View style={{ width: 40, alignItems: 'flex-end', justifyContent: 'center' }}>{right}</View>
    </View>
  );
}
