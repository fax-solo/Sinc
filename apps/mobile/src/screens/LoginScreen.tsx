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

export default function LoginScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const login = useAuthStore((s) => s.login);
  const toError = useAuthError();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(toError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <Text style={[tokens.typography.title1, { color: tokens.colors.onBackground }]}>
        {t('auth.loginTitle')}
      </Text>
      <Text style={[tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}>
        {t('auth.loginSubtitle')}
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
        label={t('auth.password')}
        placeholder={t('auth.password')}
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
        editable={!submitting}
        onSubmitEditing={submit}
      />

      {error ? (
        <Text style={[tokens.typography.caption, { color: tokens.colors.error }]}>{error}</Text>
      ) : null}

      <AppButton
        label={submitting ? t('auth.signingIn') : t('auth.signIn')}
        onPress={submit}
        disabled={submitting || email.length === 0 || password.length === 0}
      />

      <AppButton
        label={t('auth.forgotPassword')}
        variant="ghost"
        onPress={() => navigation.navigate('ForgotPassword')}
      />
      <AppButton
        label={t('auth.noAccount')}
        variant="ghost"
        onPress={() => navigation.navigate('Register')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
    gap: 14,
  },
});
