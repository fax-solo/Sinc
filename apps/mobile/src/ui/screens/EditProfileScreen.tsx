import { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { colors, radii, spacing } from '../theme';
import { AVATAR_PRESETS, useProfileStore } from '../../features/profile/profileStore';
import { saveBackupToDevice } from '../../services/backup/backupService';
import { toast } from '../components/Overlays';

export function EditProfileScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const profile = useProfileStore();
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio);
  const [selectedAvatarId, setSelectedAvatarId] = useState(profile.avatarId);

  const selectedPreset =
    AVATAR_PRESETS.find((p) => p.id === selectedAvatarId) ?? AVATAR_PRESETS[0];

  const handleSave = async () => {
    profile.updateProfile({
      username: username.trim() || 'Solo',
      bio: bio.trim() || 'Music Lover 🎵',
      avatarId: selectedAvatarId,
    });
    // Persist to phone storage backup automatically
    void saveBackupToDevice();
    toast('Profile updated successfully', 'success');
    navigation.goBack();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.card,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <Text variant="headline">Edit Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar Display with Camera Button */}
        <View style={{ alignItems: 'center', marginVertical: spacing.lg }}>
          <View style={{ position: 'relative' }}>
            <Image
              source={{ uri: selectedPreset.url }}
              style={{
                width: 108,
                height: 108,
                borderRadius: 54,
                backgroundColor: selectedPreset.backgroundColor,
                borderWidth: 2,
                borderColor: colors.borderSoft,
              }}
            />
            <View
              style={{
                position: 'absolute',
                bottom: 2,
                right: 2,
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: colors.card,
                borderWidth: 2,
                borderColor: colors.background,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="camera" size={16} color={colors.text} />
            </View>
          </View>
        </View>

        {/* Username Field */}
        <View style={{ marginBottom: spacing.lg }}>
          <Text variant="caption" style={{ marginBottom: spacing.xs, color: colors.textSecondary }}>
            Username
          </Text>
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.borderSoft,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
            }}
          >
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="Username"
              placeholderTextColor={colors.textMuted}
              style={{
                color: colors.text,
                fontSize: 16,
                fontWeight: '600',
                padding: 0,
              }}
            />
          </View>
        </View>

        {/* Bio Field */}
        <View style={{ marginBottom: spacing.lg }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: spacing.xs,
            }}
          >
            <Text variant="caption" style={{ color: colors.textSecondary }}>
              Bio
            </Text>
            <Text variant="caption" style={{ color: colors.textMuted }}>
              {bio.length}/100
            </Text>
          </View>
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.borderSoft,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
            }}
          >
            <TextInput
              value={bio}
              onChangeText={(text) => setBio(text.slice(0, 100))}
              placeholder="Music Lover 🎵"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={2}
              style={{
                color: colors.text,
                fontSize: 15,
                padding: 0,
                minHeight: 44,
              }}
            />
          </View>
        </View>

        {/* Avatar Preset Selection */}
        <View style={{ marginBottom: spacing.xl }}>
          <Text variant="caption" style={{ marginBottom: spacing.sm, color: colors.textSecondary }}>
            Avatar
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
            {AVATAR_PRESETS.map((preset) => {
              const isSelected = preset.id === selectedAvatarId;
              return (
                <Pressable
                  key={preset.id}
                  onPress={() => setSelectedAvatarId(preset.id)}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Image
                    source={{ uri: preset.url }}
                    style={{
                      width: 68,
                      height: 68,
                      borderRadius: radii.md,
                      backgroundColor: preset.backgroundColor,
                      borderWidth: isSelected ? 3 : 1,
                      borderColor: isSelected ? colors.accent : colors.borderSoft,
                    }}
                  />
                </Pressable>
              );
            })}
            <View
              style={{
                width: 68,
                height: 68,
                borderRadius: radii.md,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.borderSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.textMuted} />
            </View>
          </ScrollView>
        </View>

        {/* Buttons */}
        <View style={{ gap: spacing.md, marginTop: spacing.md }}>
          <Pressable
            onPress={handleSave}
            style={({ pressed }) => ({
              backgroundColor: colors.accent,
              borderRadius: radii.full,
              paddingVertical: 16,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ color: colors.onAccent, fontSize: 16, fontWeight: '700' }}>
              Save Changes
            </Text>
          </Pressable>

          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => ({
              paddingVertical: 14,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 15, fontWeight: '600' }}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
