import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeProvider';
import AppButton from '../components/AppButton';
import FormField from '../components/FormField';
import { useAuthStore } from '../state/authStore';
import { authApi } from '../api/auth';
import { useAuthError } from '../api/authErrors';
import type { AuthStackParamList } from '../navigation/types';

export default function VerifyEmailScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const route = useRoute<RouteProp<AuthStackParamList, 'VerifyEmail'>>();
  const verifyEmail = useAuthStore((s) => s.verifyEmail);
  const toError = useAuthError();

  const [token, setToken] = useState(route.params?.token ?? '');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting || token.length === 0) return;
    setError(null);
    setSubmitting(true);
    try {
      await verifyEmail(token.trim());
    } catch (err) {
      setError(toError(err));
    } finally {
      setSubmitting(false);
    }
  };

  // If the deep link carried a token, verify immediately (intentional mount action).
  useEffect(() => {
    if (route.params?.token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-start on deep link
      void submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resend = async () => {
    if (email.length === 0) {
      setError(t('auth.email'));
      return;
    }
    setInfo(null);
    setError(null);
    try {
      await authApi.resendVerification(email.trim());
      setInfo(t('auth.verificationSent'));
    } catch (err) {
      setError(toError(err));
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <Text style={[tokens.typography.title1, { color: tokens.colors.onBackground }]}>
        {t('auth.verifyTitle')}
      </Text>
      <Text style={[tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}>
        {t('auth.verifySubtitle')}
      </Text>

      <FormField
        label={t('auth.verificationToken')}
        placeholder={t('auth.verificationToken')}
        autoCapitalize="none"
        autoCorrect={false}
        value={token}
        onChangeText={setToken}
        editable={!submitting}
      />

      {error ? (
        <Text style={[tokens.typography.caption, { color: tokens.colors.error }]}>{error}</Text>
      ) : null}
      {info ? (
        <Text style={[tokens.typography.caption, { color: tokens.colors.primary }]}>{info}</Text>
      ) : null}

      <AppButton
        label={submitting ? t('auth.verifying') : t('auth.verify')}
        onPress={submit}
        disabled={submitting || token.length === 0}
      />

      <FormField
        label={t('auth.email')}
        placeholder={t('auth.email')}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <AppButton label={t('auth.resendCode')} variant="ghost" onPress={resend} />
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
