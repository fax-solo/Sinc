import { Pressable } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { v2Colors } from '../theme';

interface V2IconButtonProps {
  name: string;
  size?: number;
  color?: string;
  filled?: boolean;
  label: string;
  onPress: () => void;
}

/** Round tappable icon; `filled` gives it the elevated-disc treatment. */
export function V2IconButton({
  name,
  size = 22,
  color = v2Colors.textSecondary,
  filled = false,
  label,
  onPress,
}: V2IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: filled ? v2Colors.surfaceElevated : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={name as never} size={size} color={color} />
    </Pressable>
  );
}
