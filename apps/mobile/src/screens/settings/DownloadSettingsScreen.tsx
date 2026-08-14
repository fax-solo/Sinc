import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { getDatabase } from '../../db/database';
import { downloadsQuery } from '../../db/downloads';
import type { Download } from '../../db/models';
import { useQuery } from '../../db/useQuery';
import { useTheme } from '../../theme/ThemeProvider';
import { downloadService } from '../../downloads/instance';
import SettingsSection from '../../components/SettingsSection';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export default function DownloadSettingsScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const db = useMemo(() => getDatabase(), []);
  const jobs = useQuery<Download>(useMemo(() => downloadsQuery(db), [db]));
  const [usedBytes, setUsedBytes] = useState(0);

  useFocusEffect(
    useCallback(() => {
      void downloadService
        .storageInfo()
        .then(() => setUsedBytes(jobs.reduce((sum, job) => sum + job.bytesDownloaded, 0)));
    }, [jobs]),
  );

  const completed = jobs.filter((job) => job.status === 'COMPLETED').length;

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <SettingsSection
        section="downloads"
        title={t('downloads.settings')}
        rows={[
          { key: 'wifiOnly', label: t('downloads.wifiOnly') },
          { key: 'mobileDataAllowed', label: t('settings.mobileDataAllowed') },
          { key: 'autoRetry', label: t('settings.autoRetry') },
          { key: 'downloadArtwork', label: t('settings.downloadArtwork') },
          { key: 'downloadLyrics', label: t('settings.downloadLyrics') },
          { key: 'embedMetadata', label: t('settings.embedMetadata') },
        ]}
      />
      <View style={styles.storage}>
        <View>
          <Text style={[tokens.typography.body, { color: tokens.colors.onSurface }]}>
            {t('downloads.storageUsage', { size: formatBytes(usedBytes) })}
          </Text>
          <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
            {jobs.length} {t('downloads.queue')} · {completed} {t('downloads.completed')}
          </Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => void downloadService.clearCompleted(db)}
        >
          <Text style={[tokens.typography.caption, { color: tokens.colors.primary }]}>
            {t('downloads.clearCompleted')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  storage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
