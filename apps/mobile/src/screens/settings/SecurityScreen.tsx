import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/ThemeProvider';
import AppButton from '../../components/AppButton';
import { usersApi } from '../../api/users';

interface Session {
  id: string;
  deviceId: string;
  isCurrent: boolean;
  lastUsedAt: string;
}

export default function SecurityScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void usersApi
      .listSessions()
      .then(({ sessions: list }) => {
        if (!cancelled) setSessions(list);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const revokeAll = async () => {
    setMessage(null);
    try {
      await usersApi.revokeAllSessions();
      setSessions((prev) => prev.filter((s) => s.isCurrent));
      setMessage(t('settings.sessionsRevoked'));
    } catch {
      setMessage(t('common.error'));
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <Text style={[tokens.typography.title1, { color: tokens.colors.onBackground }]}>
        {t('profile.security')}
      </Text>
      <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
        {t('settings.activeSessions')}
      </Text>
      {sessions.map((session) => (
        <View
          key={session.id}
          style={[styles.row, { backgroundColor: tokens.colors.surfaceContainer }]}
        >
          <Text style={[tokens.typography.body, { color: tokens.colors.onSurface }]}>
            {session.deviceId}
            {session.isCurrent ? ` (${t('settings.currentDevice')})` : ''}
          </Text>
          <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
            {new Date(session.lastUsedAt).toLocaleString()}
          </Text>
        </View>
      ))}
      {message ? (
        <Text style={[tokens.typography.caption, { color: tokens.colors.primary }]}>{message}</Text>
      ) : null}
      <AppButton label={t('settings.signOutAllDevices')} onPress={() => void revokeAll()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 20,
    gap: 12,
  },
  row: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 2,
  },
});
