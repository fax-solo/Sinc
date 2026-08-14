import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeProvider';
import AppButton from '../components/AppButton';
import FormField from '../components/FormField';
import { useAuthStore } from '../state/authStore';
import { useAuthError } from '../api/authErrors';
import type { AuthStackParamList } from '../navigation/types';

export default function RegisterScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const register = useAuthStore((s) => s.register);
  const toError = useAuthError();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    if (password !== confirm) {
      setError(t('auth.passwordsMismatch'));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await register({
        email: email.trim(),
        username: username.trim(),
        displayName: displayName.trim() || undefined,
        password,
        locale: undefined,
      });
      // Account created; email verification is pending, guide the user there.
      navigation.navigate('VerifyEmail');
    } catch (err) {
      setError(toError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <Text style={[tokens.typography.title1, { color: tokens.colors.onBackground }]}>
        {t('auth.registerTitle')}
      </Text>
      <Text style={[tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}>
        {t('auth.registerSubtitle')}
      </Text>

      <FormField
        label={t('auth.email')}
        placeholder={t('auth.email')}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
        editable={!submitting}
      />
      <FormField
        label={t('auth.username')}
        placeholder={t('auth.username')}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        value={username}
        onChangeText={setUsername}
        editable={!submitting}
      />
      <FormField
        label={t('auth.displayName')}
        placeholder={t('auth.displayName')}
        value={displayName}
        onChangeText={setDisplayName}
        editable={!submitting}
      />
      <FormField
        label={t('auth.password')}
        placeholder={t('auth.password')}
        secureTextEntry
        autoComplete="password-new"
        value={password}
        onChangeText={setPassword}
        editable={!submitting}
      />
      <FormField
        label={t('auth.confirmPassword')}
        placeholder={t('auth.confirmPassword')}
        secureTextEntry
        autoComplete="password-new"
        value={confirm}
        onChangeText={setConfirm}
        editable={!submitting}
        onSubmitEditing={submit}
      />

      {error ? (
        <Text style={[tokens.typography.caption, { color: tokens.colors.error }]}>{error}</Text>
      ) : null}

      <AppButton
        label={submitting ? t('auth.creatingAccount') : t('auth.createAccount')}
        onPress={submit}
        disabled={
          submitting || email.length === 0 || username.length === 0 || password.length === 0
        }
      />

      <AppButton
        label={t('auth.alreadyHaveAccount')}
        variant="ghost"
        onPress={() => navigation.navigate('Login')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
    gap: 12,
  },
});
