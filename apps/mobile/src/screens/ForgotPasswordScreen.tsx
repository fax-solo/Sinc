import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import AppButton from '../components/AppButton';
import FormField from '../components/FormField';
import { authApi } from '../api/auth';
import { useAuthError } from '../api/authErrors';

type Step = 'request' | 'reset' | 'done';

export default function ForgotPasswordScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const toError = useAuthError();

  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const requestReset = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await authApi.requestPasswordReset(email.trim());
      setStep('reset');
    } catch (err) {
      setError(toError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmReset = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await authApi.confirmPasswordReset(token.trim(), newPassword);
      setStep('done');
    } catch (err) {
      setError(toError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'done') {
    return (
      <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
        <Text style={[tokens.typography.title1, { color: tokens.colors.onBackground }]}>
          {t('auth.resetPassword')}
        </Text>
        <Text style={[tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}>
          {t('auth.resetDone')}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <Text style={[tokens.typography.title1, { color: tokens.colors.onBackground }]}>
        {t('auth.forgotTitle')}
      </Text>
      {step === 'request' ? (
        <>
          <Text style={[tokens.typography.body, { color: tokens.colors.onSurfaceVariant }]}>
            {t('auth.forgotSubtitle')}
          </Text>
          <FormField
            label={t('auth.email')}
            placeholder={t('auth.email')}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            editable={!submitting}
          />
          {error ? (
            <Text style={[tokens.typography.caption, { color: tokens.colors.error }]}>{error}</Text>
          ) : null}
          <AppButton
            label={submitting ? t('auth.sending') : t('auth.sendResetLink')}
            onPress={requestReset}
            disabled={submitting || email.length === 0}
          />
          <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
            {t('auth.resetSent')}
          </Text>
        </>
      ) : (
        <>
          <FormField
            label={t('auth.verificationToken')}
            placeholder={t('auth.verificationToken')}
            autoCapitalize="none"
            autoCorrect={false}
            value={token}
            onChangeText={setToken}
            editable={!submitting}
          />
          <FormField
            label={t('auth.newPassword')}
            placeholder={t('auth.newPassword')}
            secureTextEntry
            autoComplete="password-new"
            value={newPassword}
            onChangeText={setNewPassword}
            editable={!submitting}
          />
          {error ? (
            <Text style={[tokens.typography.caption, { color: tokens.colors.error }]}>{error}</Text>
          ) : null}
          <AppButton
            label={submitting ? t('auth.resettingPassword') : t('auth.resetPassword')}
            onPress={confirmReset}
            disabled={submitting || token.length === 0 || newPassword.length === 0}
          />
        </>
      )}
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
