import {
  Image,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { colors, radii, spacing } from '../theme';
import { AVATAR_PRESETS, useProfileStore } from '../../features/profile/profileStore';
import { APP_VERSION } from '../../services/updates/appUpdates';
import type { RootStackParamList } from '../../app/navigation/types';

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const profile = useProfileStore();

  const selectedPreset =
    AVATAR_PRESETS.find((p) => p.id === profile.avatarId) ?? AVATAR_PRESETS[0];

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
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>
          Settings
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Account Section */}
        <View style={{ marginBottom: spacing.xl }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: spacing.sm }}>
            Account
          </Text>
          <Pressable
            onPress={() => navigation.navigate('EditProfile')}
            style={({ pressed }) => ({
              backgroundColor: colors.card,
              borderRadius: radii.lg,
              borderWidth: 1,
              borderColor: colors.borderSoft,
              padding: spacing.md,
              flexDirection: 'row',
              alignItems: 'center',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Image
              source={{ uri: selectedPreset.url }}
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: selectedPreset.backgroundColor,
                marginRight: spacing.md,
              }}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>
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
        </View>

        {/* App Preferences */}
        <View style={{ marginBottom: spacing.xl }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: spacing.sm }}>
            App Preferences
          </Text>
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.borderSoft,
              overflow: 'hidden',
            }}
          >
            <SettingsRow
              icon="color-palette-outline"
              title="Appearance"
              value={profile.theme.charAt(0).toUpperCase() + profile.theme.slice(1)}
              onPress={() => navigation.navigate('Appearance')}
            />
            <SettingsRow
              icon="musical-notes-outline"
              title="Playback"
              onPress={() => navigation.navigate('Queue')}
            />
            <SettingsRow
              icon="notifications-outline"
              title="Notifications"
              onPress={() => navigation.navigate('Notifications')}
            />
            <SettingsRow
              icon="musical-notes-outline"
              title="Import from Spotify"
              onPress={() => navigation.navigate('SpotifyImport')}
            />
            <SettingsRow
              icon="server-outline"
              title="Data & Storage"
              onPress={() => navigation.navigate('StorageDownloads')}
            />
            <SettingsRow
              icon="shield-checkmark-outline"
              title="Privacy"
              onPress={() => navigation.navigate('Security')}
            />
            <SettingsRow
              icon="globe-outline"
              title="Language"
              value="English"
              onPress={() => {}}
            />
          </View>
        </View>

        {/* About Section */}
        <View style={{ marginBottom: spacing.xl }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: spacing.sm }}>
            About
          </Text>
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.borderSoft,
              overflow: 'hidden',
            }}
          >
            <SettingsRow
              icon="information-circle-outline"
              title="About the App"
              value={`Version ${APP_VERSION}`}
              onPress={() => navigation.navigate('About')}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function SettingsRow({
  icon,
  title,
  value,
  onPress,
}: {
  icon: string;
  title: string;
  value?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 54,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderSoft,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon as any} size={20} color={colors.textSecondary} style={{ marginRight: spacing.md }} />
      <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.text }}>
        {title}
      </Text>
      {value ? (
        <Text style={{ fontSize: 13, color: colors.textMuted, marginRight: spacing.xs }}>
          {value}
        </Text>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}
