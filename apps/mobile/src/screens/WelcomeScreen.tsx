import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeProvider';
import AppButton from '../components/AppButton';
import type { AuthStackParamList } from '../navigation/types';

export default function WelcomeScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <Text
        style={[tokens.typography.display, styles.title, { color: tokens.colors.onBackground }]}
      >
        {t('app.name')}
      </Text>
      <Text style={[tokens.typography.callout, { color: tokens.colors.onSurfaceVariant }]}>
        {t('auth.welcome')}
      </Text>

      <View style={styles.actions}>
        <AppButton label={t('auth.register')} onPress={() => navigation.navigate('Register')} />
        <AppButton
          label={t('auth.login')}
          variant="ghost"
          onPress={() => navigation.navigate('Login')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    marginBottom: 8,
  },
  actions: {
    marginTop: 48,
    alignSelf: 'stretch',
    gap: 12,
  },
});
