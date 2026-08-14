import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { Q, type Query } from '@nozbe/watermelondb';
import { getDatabase } from '../db/database';
import { downloadsQuery } from '../db/downloads';
import type { Download } from '../db/models';
import { useQuery } from '../db/useQuery';
import { useTheme } from '../theme/ThemeProvider';
import { downloadService } from '../downloads/instance';
import { EmptyState } from '../components/ScreenState';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function ActionButton({
  label,
  onPress,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.action, { borderColor: danger ? tokens.colors.error : tokens.colors.outline }]}
    >
      <Text
        style={[
          tokens.typography.caption,
          { color: danger ? tokens.colors.error : tokens.colors.primary },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function statusLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  job: Download,
): string {
  switch (job.status) {
    case 'DOWNLOADING':
      return t('downloads.statusDownloading', { pct: job.progressPct });
    case 'QUEUED':
      return t('downloads.statusQueued');
    case 'PAUSED':
      return t('downloads.statusPaused');
    case 'COMPLETED':
      return t('downloads.completed');
    case 'FAILED':
      return job.errorMessage ?? t('downloads.failed');
    default:
      return job.status;
  }
}

function DownloadRow({ job }: { job: Download }): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const db = useMemo(() => getDatabase(), []);
  const onPause = () => void downloadService.pauseDownload(db, job.id);
  const onResume = () => void downloadService.resumeDownload(db, job.id);
  const onCancel = () => void downloadService.cancelDownload(db, job.id);
  const onRetry = () => void downloadService.retryDownload(db, job.id);
  const onDelete = () => void downloadService.deleteDownload(db, job.id);

  const actions: React.JSX.Element[] = [];
  if (job.status === 'DOWNLOADING' || job.status === 'QUEUED' || job.status === 'RESOLVING') {
    actions.push(<ActionButton key="pause" label={t('downloads.pause')} onPress={onPause} />);
    actions.push(
      <ActionButton key="cancel" label={t('downloads.cancel')} onPress={onCancel} danger />,
    );
  } else if (job.status === 'PAUSED') {
    actions.push(<ActionButton key="resume" label={t('downloads.resume')} onPress={onResume} />);
    actions.push(
      <ActionButton key="cancel" label={t('downloads.cancel')} onPress={onCancel} danger />,
    );
  } else if (job.status === 'FAILED') {
    actions.push(<ActionButton key="retry" label={t('downloads.retry')} onPress={onRetry} />);
    actions.push(
      <ActionButton key="delete" label={t('downloads.delete')} onPress={onDelete} danger />,
    );
  } else if (job.status === 'COMPLETED') {
    actions.push(
      <ActionButton key="delete" label={t('downloads.delete')} onPress={onDelete} danger />,
    );
  }

  const progress =
    job.status === 'DOWNLOADING'
      ? Math.max(0, Math.min(100, job.progressPct))
      : job.status === 'COMPLETED'
        ? 100
        : 0;

  return (
    <View style={styles.rowCard}>
      <View style={[styles.artworkWrap, { backgroundColor: tokens.colors.surfaceContainerHigh }]}>
        <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
          {(job.title ?? '♪').slice(0, 1)}
        </Text>
      </View>
      <View style={styles.rowBody}>
        <Text
          numberOfLines={1}
          style={[tokens.typography.body, { color: tokens.colors.onSurface }]}
        >
          {job.title}
        </Text>
        <Text
          numberOfLines={1}
          style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}
        >
          {job.artist ?? statusLabel(t, job)}
        </Text>
        <View
          style={[styles.progressTrack, { backgroundColor: tokens.colors.surfaceContainerHigh }]}
        >
          <View
            style={[
              styles.progressFill,
              {
                width: `${progress}%`,
                backgroundColor:
                  job.status === 'FAILED' ? tokens.colors.error : tokens.colors.primary,
              },
            ]}
          />
        </View>
        {job.status !== 'COMPLETED' && job.status !== 'FAILED' ? (
          <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
            {statusLabel(t, job)}
          </Text>
        ) : null}
        <View style={styles.actions}>{actions}</View>
      </View>
    </View>
  );
}

export default function DownloadsScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const db = useMemo(() => getDatabase(), []);
  const jobs = useQuery<Download>(
    useMemo(() => downloadsQuery(db).extend(Q.sortBy('added_at', Q.desc)) as Query<Download>, [db]),
  );
  const [lowStorage, setLowStorage] = useState(false);

  const refreshStorage = useCallback(() => {
    void downloadService.storageInfo().then(({ low }) => setLowStorage(low));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshStorage();
    }, [refreshStorage]),
  );

  useEffect(() => {
    if (!lowStorage) return;
    const timer = setInterval(refreshStorage, 10000);
    return () => clearInterval(timer);
  }, [lowStorage, refreshStorage]);

  const completed = jobs.filter((job) => job.status === 'COMPLETED').length;
  const bytes = jobs.reduce((sum, job) => sum + job.bytesDownloaded, 0);

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      {lowStorage ? (
        <View style={[styles.banner, { backgroundColor: tokens.colors.errorContainer }]}>
          <Text style={[tokens.typography.caption, { color: tokens.colors.onErrorContainer }]}>
            {t('downloads.lowStorage')}
          </Text>
        </View>
      ) : null}
      {jobs.length === 0 ? (
        <EmptyState title={t('downloads.emptyTitle')} body={t('downloads.emptyBody')} />
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(job) => job.id}
          renderItem={({ item }) => <DownloadRow job={item} />}
          contentContainerStyle={styles.list}
        />
      )}
      <View style={[styles.footer, { backgroundColor: tokens.colors.surfaceContainer }]}>
        <Text style={[tokens.typography.caption, { color: tokens.colors.onSurfaceVariant }]}>
          {t('downloads.storageUsage', {
            size: completed > 0 ? formatBytes(bytes) : '0 B',
          })}
        </Text>
        {completed > 0 ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => void downloadService.clearCompleted(db)}
          >
            <Text style={[tokens.typography.caption, { color: tokens.colors.primary }]}>
              {t('downloads.clearCompleted')}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  banner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  list: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rowCard: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
  },
  artworkWrap: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  action: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
