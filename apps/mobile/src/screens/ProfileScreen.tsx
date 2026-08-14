import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeProvider';
import AppButton from '../components/AppButton';
import { useAuthStore } from '../state/authStore';
import type { ProfileTabParamList } from '../navigation/types';

export default function ProfileScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileTabParamList>>();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const rows: Array<{ key: keyof ProfileTabParamList; label: string }> = [
    { key: 'Account', label: t('profile.account') },
    { key: 'PlaybackSettings', label: t('profile.playback') },
    { key: 'DownloadSettings', label: t('downloads.settings') },
    { key: 'LyricsSettings', label: t('profile.lyrics') },
    { key: 'Notifications', label: t('profile.notifications') },
    { key: 'Storage', label: t('profile.storage') },
    { key: 'Privacy', label: t('profile.privacy') },
    { key: 'Security', label: t('profile.security') },
    { key: 'About', label: t('profile.about') },
  ];

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <Text style={[tokens.typography.title1, { color: tokens.colors.onBackground }]}>
        {t('tabs.profile')}
      </Text>

      <View style={[styles.header, { backgroundColor: tokens.colors.surfaceContainer }]}>
        <View style={[styles.avatar, { backgroundColor: tokens.colors.primary }]}>
          <Text style={[tokens.typography.title1, { color: tokens.colors.onPrimary }]}>
            {(user?.displayName ?? user?.username ?? '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={styles.headerText}>
          <Text style={[tokens.typography.headline, { color: tokens.colors.onSurface }]}>
            {user?.displayName ?? user?.username ?? '—'}
          </Text>
          <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
            @{user?.username ?? ''}
          </Text>
        </View>
      </View>

      {rows.map((row) => (
        <AppButton
          key={row.key}
          label={row.label}
          variant="ghost"
          onPress={() => navigation.navigate(row.key)}
        />
      ))}

      <AppButton label={t('auth.logout')} onPress={() => void logout()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 20,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
});
