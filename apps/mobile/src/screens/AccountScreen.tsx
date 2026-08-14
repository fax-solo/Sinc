import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import AppButton from '../components/AppButton';
import FormField from '../components/FormField';
import { useAuthStore } from '../state/authStore';
import { usersApi } from '../api/users';
import { useAuthError } from '../api/authErrors';

export default function AccountScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const clearSession = useAuthStore((s) => s.clearSession);
  const toError = useAuthError();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [deletePassword, setDeletePassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const saveProfile = async () => {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const { user: updated } = await usersApi.updateProfile({
        displayName: displayName.trim() || undefined,
        username: username.trim() || undefined,
      });
      setUser(updated);
    } catch (err) {
      setError(toError(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async () => {
    setError(null);
    try {
      await usersApi.deleteAccount(deletePassword);
      clearSession();
    } catch (err) {
      setError(toError(err));
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <Text style={[tokens.typography.title1, { color: tokens.colors.onBackground }]}>
        {t('profile.account')}
      </Text>
      <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
        @{user?.username ?? ''}
      </Text>

      <FormField
        label={t('auth.username')}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
      />
      <FormField label={t('auth.displayName')} value={displayName} onChangeText={setDisplayName} />

      {error ? (
        <Text style={[tokens.typography.caption, { color: tokens.colors.error }]}>{error}</Text>
      ) : null}

      <AppButton
        label={saving ? t('common.loading') : t('common.save')}
        onPress={() => void saveProfile()}
        disabled={saving || username.length === 0}
      />

      <Text style={[tokens.typography.title1, { color: tokens.colors.error }]}>
        {t('settings.dangerZone')}
      </Text>
      <FormField
        label={t('auth.password')}
        secureTextEntry
        value={deletePassword}
        onChangeText={setDeletePassword}
        placeholder={t('settings.confirmToDelete')}
      />
      <AppButton label={t('settings.deleteAccount')} onPress={() => void deleteAccount()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 20,
    gap: 12,
  },
});
