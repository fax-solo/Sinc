import { Modal, Pressable, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Text } from './Text';
import { colors, radii, spacing } from '../theme';

interface LogOutModalProps {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function LogOutModal({ visible, onCancel, onConfirm }: LogOutModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.7)',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacing.xl,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 340,
            backgroundColor: '#161E1B',
            borderRadius: radii.xl,
            borderWidth: 1,
            borderColor: colors.borderSoft,
            padding: spacing.xl,
            alignItems: 'center',
          }}
        >
          {/* Green App Icon */}
          <View
            style={{
              width: 58,
              height: 58,
              borderRadius: radii.md,
              backgroundColor: 'rgba(30, 215, 96, 0.18)',
              borderWidth: 1,
              borderColor: 'rgba(30, 215, 96, 0.35)',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: spacing.md,
            }}
          >
            <Ionicons name="musical-notes" size={30} color={colors.accent} />
          </View>

          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: spacing.xs }}>
            Log Out
          </Text>

          <Text
            style={{
              fontSize: 14,
              color: colors.textMuted,
              textAlign: 'center',
              lineHeight: 20,
              marginBottom: spacing.xl,
            }}
          >
            Are you sure you want to log out from your account?
          </Text>

          {/* Action Buttons */}
          <View style={{ flexDirection: 'row', gap: spacing.md, width: '100%' }}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 14,
                borderRadius: radii.full,
                backgroundColor: colors.card,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.textSecondary }}>
                Cancel
              </Text>
            </Pressable>

            <Pressable
              onPress={onConfirm}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 14,
                borderRadius: radii.full,
                backgroundColor: colors.accent,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.onAccent }}>
                Log Out
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
