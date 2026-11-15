import {
  Modal,
  Pressable,
  ScrollView,
  View,
  Image,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text } from './Text';
import { colors, radii, spacing } from '../theme';
import { AVATAR_PRESETS, useProfileStore } from '../../features/profile/profileStore';
import type { RootStackParamList } from '../../app/navigation/types';
import { LogOutModal } from './LogOutModal';

interface ProfileQuickSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function ProfileQuickSheet({ visible, onClose }: ProfileQuickSheetProps) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const profile = useProfileStore();
  const [logOutModalVisible, setLogOutModalVisible] = useState(false);

  const selectedPreset =
    AVATAR_PRESETS.find((p) => p.id === profile.avatarId) ?? AVATAR_PRESETS[0];

  const navigateTo = (screen: any, params?: any) => {
    onClose();
    if (params) {
      navigation.navigate(screen, params);
    } else {
      navigation.navigate(screen);
    }
  };

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />

          <View
            style={{
              backgroundColor: '#121715',
              borderTopLeftRadius: radii.xxl,
              borderTopRightRadius: radii.xxl,
              paddingTop: spacing.md,
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.xxl,
              maxHeight: '85%',
            }}
          >
            {/* Grab Handle */}
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: colors.border,
                alignSelf: 'center',
                marginBottom: spacing.lg,
              }}
            />

            {/* User Header */}
            <Pressable
              onPress={() => navigateTo('EditProfile')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: spacing.lg,
                paddingBottom: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.borderSoft,
              }}
            >
              <Image
                source={{ uri: selectedPreset.url }}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  backgroundColor: selectedPreset.backgroundColor,
                  marginRight: spacing.md,
                }}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>
                  {profile.username}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.accent }}>
                    {profile.badge}
                  </Text>
                  <Ionicons name="shield-checkmark" size={13} color={colors.accent} />
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>

            {/* Menu Items */}
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
              <SheetRow
                icon="person-outline"
                title="Profile"
                onPress={() => {
                  onClose();
                }}
              />
              <SheetRow
                icon="settings-outline"
                title="Settings"
                onPress={() => navigateTo('Settings')}
              />
              <SheetRow
                icon="download-outline"
                title="Downloads"
                onPress={() => navigateTo('Downloads')}
              />
              <SheetRow
                icon="library-outline"
                title="Your Library"
                onPress={() => navigateTo('Main', { screen: 'Library' })}
              />
              <SheetRow
                icon="moon-outline"
                title="Sleep Timer"
                onPress={() => navigateTo('Settings')}
              />
              <SheetRow
                icon="color-palette-outline"
                title="Appearance"
                onPress={() => navigateTo('Appearance')}
              />
              <SheetRow
                icon="help-circle-outline"
                title="Help & Support"
                onPress={() => navigateTo('About')}
              />
              <SheetRow
                icon="information-circle-outline"
                title="About"
                onPress={() => navigateTo('About')}
              />

              {/* Log Out Button */}
              <Pressable
                onPress={() => setLogOutModalVisible(true)}
                style={({ pressed }) => ({
                  marginTop: spacing.md,
                  minHeight: 52,
                  borderRadius: radii.md,
                  backgroundColor: 'rgba(255, 91, 101, 0.12)',
                  borderWidth: 1,
                  borderColor: 'rgba(255, 91, 101, 0.25)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: spacing.sm,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Ionicons name="log-out-outline" size={18} color={colors.error} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.error }}>
                  Log Out
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Confirmation Modal */}
      <LogOutModal
        visible={logOutModalVisible}
        onCancel={() => setLogOutModalVisible(false)}
        onConfirm={() => {
          setLogOutModalVisible(false);
          onClose();
          profile.resetProfile();
        }}
      />
    </>
  );
}

function SheetRow({
  icon,
  title,
  onPress,
}: {
  icon: string;
  title: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.sm,
        borderRadius: radii.sm,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ width: 32, alignItems: 'flex-start' }}>
        <Ionicons name={icon as any} size={20} color={colors.textSecondary} />
      </View>
      <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.text }}>
        {title}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}
