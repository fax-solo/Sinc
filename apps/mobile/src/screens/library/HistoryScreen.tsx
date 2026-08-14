import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getDatabase } from '../../db/database';
import { historyQuery } from '../../db/repositories';
import { useQuery } from '../../db/useQuery';
import type { HistoryEntry, Track } from '../../db/models';
import { useTheme } from '../../theme/ThemeProvider';
import SimpleRow from '../../components/SimpleRow';
import { EmptyState } from '../../components/ScreenState';
import type { LibraryTabParamList } from '../../navigation/types';

interface HistoryRow {
  key: string;
  title: string;
  artist: string | null;
  providerId: string | null;
}

function toRow(entry: HistoryEntry): HistoryRow {
  return {
    key: entry.id,
    title: entry.title ?? '—',
    artist: entry.artist,
    providerId: null,
  };
}

/** Play history, most recent first. */
export default function HistoryScreen({ limit = 100 }: { limit?: number }): React.JSX.Element {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<LibraryTabParamList>>();

  const db = useMemo(() => getDatabase(), []);
  const entries = useQuery(useMemo(() => historyQuery(db, limit), [db, limit]));
  const [rows, setRows] = useState<HistoryRow[]>([]);

  useEffect(() => {
    let mounted = true;
    void Promise.all(
      entries.map(async (entry) => {
        const row = toRow(entry);
        if (entry.trackId) {
          const track = await db.collections
            .get<Track>('tracks')
            .find(entry.trackId)
            .catch(() => null);
          if (track?.providerId) row.providerId = track.providerId;
        }
        return row;
      }),
    ).then((found) => {
      if (mounted) setRows(found);
    });
    return () => {
      mounted = false;
    };
  }, [entries, db]);

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <SimpleRow
            title={item.title}
            subtitle={item.artist ?? undefined}
            onPress={
              item.providerId
                ? () => navigation.navigate('SongDetails', { trackId: item.providerId! })
                : undefined
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState title={t('library.emptyHistory')} body={t('library.emptyHistoryBody')} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 16,
  },
});
