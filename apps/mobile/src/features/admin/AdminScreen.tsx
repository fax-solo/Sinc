import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { AppText } from '../../components/AppText';
import { AppButton } from '../../components/AppButton';
import { BarChart, formatCompact } from '../../components/BarChart';
import { useTheme } from '../../theme';
import {
  adminApi,
  type AdminActivityDay,
  type AdminDownloadRow,
  type AdminUserAction,
  type AdminUserRow,
} from '../../api/admin';

type AdminPage =
  'overview' | 'users' | 'downloads' | 'devices' | 'playlists' | 'audit' | 'system' | 'reliability';
type Period = 7 | 30 | 90;

const PERIODS: Period[] = [7, 30, 90];
const PAGE_SIZE = 30;

function StatCard({ label, value }: { label: string; value: number | string }) {
  const { colors, radii } = useTheme();
  return (
    <View
      style={[styles.statCard, { backgroundColor: colors.surfaceElevated, borderRadius: radii.md }]}
    >
      <AppText variant="title">{value}</AppText>
      <AppText variant="small" color="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

function PageTabs({ active, onSelect }: { active: AdminPage; onSelect: (p: AdminPage) => void }) {
  const { colors, spacing, radii } = useTheme();
  const tabs: { id: AdminPage; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: 'stats-chart' },
    { id: 'users', label: 'Users', icon: 'people' },
    { id: 'downloads', label: 'Downloads', icon: 'cloud-download' },
    { id: 'devices', label: 'Devices', icon: 'phone-portrait' },
    { id: 'playlists', label: 'Playlists', icon: 'musical-notes' },
    { id: 'audit', label: 'Audit', icon: 'document-text' },
    { id: 'system', label: 'System', icon: 'server' },
    { id: 'reliability', label: 'Reliability', icon: 'pulse' },
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: spacing.xs, paddingRight: spacing.md }}>
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <Pressable
              key={tab.id}
              onPress={() => onSelect(tab.id)}
              style={({ pressed }) => [
                styles.tab,
                {
                  backgroundColor: selected ? colors.accent : colors.surfaceElevated,
                  borderRadius: radii.full,
                  paddingVertical: spacing.xs,
                  paddingHorizontal: spacing.md,
                },
                pressed && styles.pressed,
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xxs }}>
                <Ionicons
                  name={tab.icon as never}
                  size={14}
                  color={selected ? colors.onAccent : colors.textSecondary}
                />
                <AppText
                  variant="small"
                  style={{ color: selected ? colors.onAccent : colors.textSecondary }}
                >
                  {tab.label}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

function ChartCard({
  title,
  data,
  color,
  hint,
}: {
  title: string;
  data: { label: string; value: number }[];
  color?: string;
  hint?: string;
}) {
  const { colors, spacing, radii } = useTheme();
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surfaceElevated, borderRadius: radii.md, padding: spacing.md },
      ]}
    >
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}
      >
        <AppText variant="headline">{title}</AppText>
        <AppText variant="body" color="accent">
          {formatCompact(total)} total
        </AppText>
      </View>
      {hint ? (
        <AppText variant="small" color="textMuted">
          {hint}
        </AppText>
      ) : null}
      <View style={{ marginTop: spacing.md }}>
        <BarChart data={data} color={color} />
      </View>
    </View>
  );
}

function dayLabel(day: string): string {
  const [, m, d] = day.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors, spacing, radii } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        {
          backgroundColor: active ? colors.accent : colors.surfaceElevated,
          borderRadius: radii.full,
          paddingVertical: spacing.xxs,
          paddingHorizontal: spacing.md,
        },
        pressed && styles.pressed,
      ]}
    >
      <AppText variant="small" style={{ color: active ? colors.onAccent : colors.textSecondary }}>
        {label}
      </AppText>
    </Pressable>
  );
}

function LoadMoreButton({
  hasMore,
  loading,
  onPress,
}: {
  hasMore: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const { spacing } = useTheme();
  if (!hasMore)
    return (
      <AppText variant="caption" color="textMuted" style={{ marginTop: spacing.md }}>
        No more results.
      </AppText>
    );
  return (
    <AppButton
      label={loading ? 'Loading…' : 'Load more'}
      variant="ghost"
      onPress={onPress}
      loading={loading}
      style={{ marginTop: spacing.md }}
    />
  );
}

function OverviewPage({ period, onPeriod }: { period: Period; onPeriod: (p: Period) => void }) {
  const { colors, spacing, radii } = useTheme();
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => adminApi.getStats() });
  const activity = useQuery({
    queryKey: ['admin', 'activity', period],
    queryFn: () => adminApi.getActivity(period),
  });
  const top = useQuery({ queryKey: ['admin', 'top'], queryFn: () => adminApi.getTop(10) });

  const charts = useMemo(() => {
    if (!activity.data) return null;
    const rows: AdminActivityDay[] = activity.data;
    return {
      visits: rows.map((r) => ({ label: dayLabel(r.day), value: r.visits })),
      plays: rows.map((r) => ({ label: dayLabel(r.day), value: r.plays })),
      activeUsers: rows.map((r) => ({ label: dayLabel(r.day), value: r.activeUsers })),
      downloads: rows.map((r) => ({ label: dayLabel(r.day), value: r.downloads })),
      signups: rows.map((r) => ({ label: dayLabel(r.day), value: r.signups })),
    };
  }, [activity.data]);

  const periodLabel =
    period === 7 ? 'Last 7 days' : period === 30 ? 'Last 30 days' : 'Last 90 days';

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md }}>
        {PERIODS.map((p) => (
          <Pressable
            key={p}
            onPress={() => onPeriod(p)}
            style={({ pressed }) => [
              styles.periodPill,
              {
                backgroundColor: p === period ? colors.accent : colors.surfaceElevated,
                borderRadius: radii.full,
                paddingVertical: spacing.xxs,
                paddingHorizontal: spacing.md,
              },
              pressed && styles.pressed,
            ]}
          >
            <AppText
              variant="small"
              style={{ color: p === period ? colors.onAccent : colors.textSecondary }}
            >
              {p === 7 ? 'Week' : p === 30 ? 'Month' : 'Quarter'}
            </AppText>
          </Pressable>
        ))}
      </View>
      <AppText variant="small" color="textMuted" style={{ marginTop: spacing.xs }}>
        {periodLabel}
      </AppText>

      {stats.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
      ) : stats.data ? (
        <View style={styles.statsGrid}>
          <StatCard label="Users" value={stats.data.users} />
          <StatCard label="Admins" value={stats.data.admins} />
          <StatCard label="Suspended" value={stats.data.suspendedUsers} />
          <StatCard label="Sessions" value={stats.data.activeSessions} />
          <StatCard label="Total visits" value={formatCompact(stats.data.visitsTotal)} />
          <StatCard label="Playlists" value={stats.data.playlists} />
          <StatCard label="Favorites" value={formatCompact(stats.data.favorites)} />
          <StatCard label="Downloads" value={formatCompact(stats.data.downloads)} />
          <StatCard label="Completed DL" value={formatCompact(stats.data.completedDownloads)} />
          <StatCard label="Lyrics cached" value={formatCompact(stats.data.lyricsCached)} />
          <StatCard label="Play history" value={formatCompact(stats.data.historyRows)} />
        </View>
      ) : null}

      {activity.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
      ) : charts ? (
        <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
          <ChartCard title="App visits" data={charts.visits} hint="Sessions started per day" />
          <ChartCard
            title="Plays"
            data={charts.plays}
            color={colors.warning}
            hint="Songs played per day"
          />
          <ChartCard
            title="Active users"
            data={charts.activeUsers}
            color="#7B5DD6"
            hint="Distinct users with a play per day"
          />
          <ChartCard
            title="Downloads"
            data={charts.downloads}
            color={colors.success}
            hint="Download jobs started per day"
          />
          <ChartCard
            title="Signups"
            data={charts.signups}
            color={colors.error}
            hint="New accounts per day"
          />
        </View>
      ) : null}

      <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceElevated,
              borderRadius: radii.md,
              padding: spacing.md,
            },
          ]}
        >
          <AppText variant="headline">Top tracks</AppText>
          <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
            {(top.data?.tracks ?? []).map((t, i) => (
              <View
                key={t.trackId}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
              >
                <AppText variant="small" color="textMuted" style={{ width: 20 }}>
                  {i + 1}
                </AppText>
                <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
                  {t.title}
                </AppText>
                <AppText
                  variant="small"
                  color="textSecondary"
                  numberOfLines={1}
                  style={{ maxWidth: 110 }}
                >
                  {t.artist ?? ''}
                </AppText>
                <AppText variant="small" color="accent">
                  {formatCompact(t.plays)}
                </AppText>
              </View>
            ))}
          </View>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceElevated,
              borderRadius: radii.md,
              padding: spacing.md,
            },
          ]}
        >
          <AppText variant="headline">Top artists</AppText>
          <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
            {(top.data?.artists ?? []).map((a, i) => (
              <View
                key={a.name}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
              >
                <AppText variant="small" color="textMuted" style={{ width: 20 }}>
                  {i + 1}
                </AppText>
                <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
                  {a.name}
                </AppText>
                <AppText variant="small" color="accent">
                  {formatCompact(a.plays)}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

function useDebounced(value: string, delayMs = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

function UserDetailCard({ userId }: { userId: string }) {
  const { colors, spacing, radii } = useTheme();
  const detail = useQuery({
    queryKey: ['admin', 'user-detail', userId],
    queryFn: () => adminApi.userDetail(userId),
  });
  const sessions = useQuery({
    queryKey: ['admin', 'sessions', userId],
    queryFn: () => adminApi.listSessions(userId),
  });

  if (detail.isLoading) {
    return (
      <ActivityIndicator color={colors.accent} size="small" style={{ marginTop: spacing.sm }} />
    );
  }
  if (!detail.data) return null;
  const d = detail.data;

  const rows: { label: string; value: number | string }[] = [
    { label: 'Email verified', value: d.emailVerified ? 'Yes' : 'No' },
    { label: 'Sessions', value: d.sessionCount },
    { label: 'Devices', value: d.devices },
    { label: 'Favorites', value: d.favorites },
    { label: 'Playlists', value: d.playlists },
    { label: 'Downloads', value: d.downloads },
    { label: 'Completed DL', value: d.completedDownloads },
    { label: 'Total plays', value: d.totalPlays },
  ];

  return (
    <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xxs }}>
        {rows.map((r) => (
          <View
            key={r.label}
            style={[
              {
                backgroundColor: colors.surface,
                borderRadius: radii.sm,
                paddingVertical: spacing.xxs,
                paddingHorizontal: spacing.sm,
              },
            ]}
          >
            <AppText variant="small" color="accent">
              {r.label}: {r.value}
            </AppText>
          </View>
        ))}
      </View>
      <AppText
        variant="small"
        color="textMuted"
        style={{ marginTop: spacing.xs, marginBottom: spacing.xs }}
      >
        Recent sessions
      </AppText>
      {(sessions.data?.sessions ?? []).slice(0, 5).map((s) => (
        <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Ionicons name="phone-portrait-outline" size={14} color={colors.textMuted} />
          <AppText variant="small" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
            {s.userAgent ?? 'Unknown device'} · {s.ipAddress ?? 'no IP'} ·{' '}
            {s.createdAt.slice(0, 16).replace('T', ' ')}
            {s.revokedAt ? ' · revoked' : ''}
          </AppText>
          {!s.revokedAt ? (
            <AppButton
              label="Revoke"
              variant="ghost"
              compact
              onPress={() => void adminApi.revokeSession(s.id).then(() => sessions.refetch())}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

function UsersPage() {
  const { colors, spacing } = useTheme();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'user' | 'admin'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [sort, setSort] = useState<'createdAt' | 'lastLoginAt'>('createdAt');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const debouncedQuery = useDebounced(query);
  const users = useQuery({
    queryKey: ['admin', 'users', debouncedQuery, roleFilter, statusFilter, sort, page],
    queryFn: () =>
      adminApi.listUsers(page, PAGE_SIZE, {
        query: debouncedQuery,
        role: roleFilter === 'all' ? undefined : roleFilter,
        status: statusFilter === 'all' ? undefined : statusFilter,
        sort,
      }),
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
  }, [queryClient]);

  const runAction = useCallback(
    async (user: AdminUserRow, action: AdminUserAction) => {
      setError(null);
      try {
        if (action === 'delete') {
          await adminApi.deleteUser(user.id);
        } else {
          const result = await adminApi.actOnUser(user.id, action);
          if (action === 'reset-password') setResetToken(result.token ?? null);
        }
        invalidate();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed');
      }
    },
    [invalidate]
  );

  const onQueryChange = useCallback((value: string) => {
    setQuery(value);
    setPage(1);
  }, []);
  const onResetFilters = useCallback(() => {
    setRoleFilter('all');
    setStatusFilter('all');
    setSort('createdAt');
    setPage(1);
  }, []);

  const total = users.data?.total ?? 0;
  const hasMore = users.data ? page * PAGE_SIZE < total : false;

  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          gap: spacing.xs,
          alignItems: 'center',
          marginTop: spacing.md,
        }}
      >
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="Search email / username"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            {
              flex: 1,
              backgroundColor: colors.surfaceElevated,
              borderRadius: 8,
              color: colors.textPrimary,
            },
          ]}
        />
        <AppButton label="Clear" variant="ghost" compact onPress={onResetFilters} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginTop: spacing.xs }}
      >
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {(['all', 'user', 'admin'] as const).map((r) => (
            <FilterChip
              key={r}
              label={r === 'all' ? 'All roles' : `${r}s`}
              active={roleFilter === r}
              onPress={() => {
                setRoleFilter(r);
                setPage(1);
              }}
            />
          ))}
          {(['all', 'active', 'suspended'] as const).map((s) => (
            <FilterChip
              key={s}
              label={s === 'all' ? 'All status' : s}
              active={statusFilter === s}
              onPress={() => {
                setStatusFilter(s);
                setPage(1);
              }}
            />
          ))}
          <FilterChip
            label="Newest"
            active={sort === 'createdAt'}
            onPress={() => {
              setSort('createdAt');
              setPage(1);
            }}
          />
          <FilterChip
            label="Last login"
            active={sort === 'lastLoginAt'}
            onPress={() => {
              setSort('lastLoginAt');
              setPage(1);
            }}
          />
        </View>
      </ScrollView>

      {error ? (
        <View
          style={[
            styles.errorBox,
            {
              backgroundColor: colors.error,
              borderRadius: 8,
              padding: spacing.sm,
              marginTop: spacing.sm,
            },
          ]}
        >
          <AppText color="onAccent">{error}</AppText>
        </View>
      ) : null}

      {resetToken ? (
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceElevated,
              borderRadius: 12,
              padding: spacing.sm,
              marginTop: spacing.sm,
            },
          ]}
        >
          <AppText variant="small" color="textSecondary">
            Password reset token (one-time, valid 24h):
          </AppText>
          <AppText variant="body" selectable>
            {resetToken}
          </AppText>
        </View>
      ) : null}

      {users.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
      ) : (
        (users.data?.users ?? []).map((user) => (
          <View
            key={user.id}
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceElevated,
                borderRadius: 12,
                padding: spacing.sm,
                marginTop: spacing.xs,
              },
            ]}
          >
            <Pressable onPress={() => setExpandedId(expandedId === user.id ? null : user.id)}>
              <AppText variant="body" numberOfLines={1}>
                {user.username}
                {user.role === 'admin' ? ' · Admin' : ''}
                {user.status === 'suspended' ? ' · Suspended' : ''}
              </AppText>
              <AppText variant="small" color="textSecondary" numberOfLines={1}>
                {user.email} · {user.sessionCount} sessions · last login{' '}
                {user.lastLoginAt ? user.lastLoginAt.slice(0, 16).replace('T', ' ') : 'never'}
              </AppText>
            </Pressable>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: spacing.xxs,
                marginTop: spacing.xs,
              }}
            >
              {user.role === 'admin' ? (
                <AppButton
                  label="Demote"
                  variant="ghost"
                  compact
                  onPress={() => void runAction(user, 'demote')}
                />
              ) : (
                <AppButton
                  label="Promote"
                  variant="ghost"
                  compact
                  onPress={() => void runAction(user, 'promote')}
                />
              )}
              {user.status === 'suspended' ? (
                <AppButton
                  label="Unsuspend"
                  variant="ghost"
                  compact
                  onPress={() => void runAction(user, 'unsuspend')}
                />
              ) : (
                <AppButton
                  label="Suspend"
                  variant="ghost"
                  compact
                  onPress={() => void runAction(user, 'suspend')}
                />
              )}
              <AppButton
                label="Reset pw"
                variant="ghost"
                compact
                onPress={() => void runAction(user, 'reset-password')}
              />
              <AppButton
                label="Delete"
                variant="ghost"
                compact
                onPress={() => void runAction(user, 'delete')}
              />
            </View>

            {expandedId === user.id ? <UserDetailCard userId={user.id} /> : null}
          </View>
        ))
      )}

      <LoadMoreButton
        hasMore={hasMore}
        loading={users.isFetching}
        onPress={() => setPage((p) => p + 1)}
      />
    </View>
  );
}

function DownloadsPage() {
  const { colors, spacing } = useTheme();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'all' | 'failed' | 'completed' | 'downloading'>(
    'all'
  );
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const debouncedQuery = useDebounced(query);
  const stats = useQuery({
    queryKey: ['admin', 'download-stats'],
    queryFn: () => adminApi.downloadStats(),
  });
  const list = useQuery({
    queryKey: ['admin', 'downloads', statusFilter, debouncedQuery, page],
    queryFn: () =>
      adminApi.listDownloads(page, PAGE_SIZE, {
        status: statusFilter === 'all' ? undefined : statusFilter,
        query: debouncedQuery,
      }),
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'downloads'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'download-stats'] });
  }, [queryClient]);

  const act = useCallback(
    async (job: AdminDownloadRow, kind: 'retry' | 'cancel') => {
      try {
        if (kind === 'retry') await adminApi.retryDownload(job.id);
        else await adminApi.cancelDownload(job.id);
        invalidate();
      } catch {
        // Surface via reload; failures here are non-fatal.
        invalidate();
      }
    },
    [invalidate]
  );

  const total = list.data?.total ?? 0;
  const hasMore = list.data ? page * PAGE_SIZE < total : false;
  const successRate = stats.data?.successRate;

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md }}>
        <TextInput
          value={query}
          onChangeText={(v) => {
            setQuery(v);
            setPage(1);
          }}
          placeholder="Search title / artist"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            {
              flex: 1,
              backgroundColor: colors.surfaceElevated,
              borderRadius: 8,
              color: colors.textPrimary,
            },
          ]}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginTop: spacing.xs }}
      >
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {(['all', 'completed', 'failed', 'downloading'] as const).map((s) => (
            <FilterChip
              key={s}
              label={s === 'all' ? 'All' : s}
              active={statusFilter === s}
              onPress={() => {
                setStatusFilter(s);
                setPage(1);
              }}
            />
          ))}
        </View>
      </ScrollView>

      {stats.data ? (
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceElevated,
              borderRadius: 12,
              padding: spacing.sm,
              marginTop: spacing.sm,
            },
          ]}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <AppText variant="small" color="textSecondary">
              Success rate
            </AppText>
            <AppText variant="small">
              {successRate == null ? '—' : `${successRate.toFixed(1)}%`}
            </AppText>
          </View>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginTop: spacing.xxs,
            }}
          >
            <AppText variant="caption" color="textMuted">
              {stats.data.completed} completed · {stats.data.failed} failed · {stats.data.total}{' '}
              total
            </AppText>
          </View>
        </View>
      ) : null}

      {list.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
      ) : (
        (list.data?.jobs ?? []).map((job) => (
          <View
            key={job.id}
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceElevated,
                borderRadius: 12,
                padding: spacing.sm,
                marginTop: spacing.xs,
              },
            ]}
          >
            <AppText variant="body" numberOfLines={1}>
              {job.trackTitle}
            </AppText>
            <AppText variant="small" color="textSecondary" numberOfLines={1}>
              {job.trackArtist} · {job.status}
              {job.provider ? ` · ${job.provider}` : ''} ·{' '}
              {job.createdAt.slice(0, 16).replace('T', ' ')}
            </AppText>
            {job.errorMessage ? (
              <AppText variant="caption" color="error" numberOfLines={2}>
                {job.errorMessage}
              </AppText>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
              {job.status === 'failed' || job.status === 'cancelled' ? (
                <AppButton
                  label="Retry"
                  variant="ghost"
                  compact
                  onPress={() => void act(job, 'retry')}
                />
              ) : null}
              {job.status === 'downloading' || job.status === 'pending' ? (
                <AppButton
                  label="Cancel"
                  variant="ghost"
                  compact
                  onPress={() => void act(job, 'cancel')}
                />
              ) : null}
            </View>
          </View>
        ))
      )}

      <LoadMoreButton
        hasMore={hasMore}
        loading={list.isFetching}
        onPress={() => setPage((p) => p + 1)}
      />
    </View>
  );
}

function DevicesPage() {
  const { colors, spacing } = useTheme();
  const queryClient = useQueryClient();
  const devices = useQuery({
    queryKey: ['admin', 'devices'],
    queryFn: () => adminApi.listDevices(),
  });

  return (
    <View>
      {devices.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
      ) : (devices.data?.devices ?? []).length === 0 ? (
        <AppText variant="body" color="textSecondary" style={{ marginTop: spacing.lg }}>
          No devices registered yet.
        </AppText>
      ) : (
        (devices.data?.devices ?? []).map((d) => (
          <View
            key={d.id}
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceElevated,
                borderRadius: 12,
                padding: spacing.sm,
                marginTop: spacing.xs,
              },
            ]}
          >
            <AppText variant="body" numberOfLines={1}>
              {d.name}
            </AppText>
            <AppText variant="small" color="textSecondary">
              {d.platform} · user {d.userId.slice(0, 8)} · last seen{' '}
              {d.lastSeenAt.slice(0, 16).replace('T', ' ')}
            </AppText>
            <View style={{ flexDirection: 'row', marginTop: spacing.xs }}>
              <AppButton
                label="Revoke device"
                variant="ghost"
                compact
                onPress={() =>
                  void adminApi
                    .revokeDevice(d.id)
                    .then(() => queryClient.invalidateQueries({ queryKey: ['admin', 'devices'] }))
                }
              />
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function PlaylistsPage() {
  const { colors, spacing } = useTheme();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const debouncedQuery = useDebounced(query);
  const playlists = useQuery({
    queryKey: ['admin', 'playlists', debouncedQuery, page],
    queryFn: () => adminApi.listPlaylists(page, PAGE_SIZE, debouncedQuery),
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'playlists'] });
  }, [queryClient]);

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await adminApi.deletePlaylist(id);
        invalidate();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Delete failed');
      }
    },
    [invalidate]
  );

  const total = playlists.data?.total ?? 0;
  const hasMore = playlists.data ? page * PAGE_SIZE < total : false;

  return (
    <View>
      <TextInput
        value={query}
        onChangeText={(v) => {
          setQuery(v);
          setPage(1);
        }}
        placeholder="Search playlists"
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            backgroundColor: colors.surfaceElevated,
            borderRadius: 8,
            color: colors.textPrimary,
            marginTop: spacing.md,
          },
        ]}
      />

      {error ? (
        <View
          style={[
            styles.errorBox,
            {
              backgroundColor: colors.error,
              borderRadius: 8,
              padding: spacing.sm,
              marginTop: spacing.sm,
            },
          ]}
        >
          <AppText color="onAccent">{error}</AppText>
        </View>
      ) : null}

      {playlists.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
      ) : (playlists.data?.playlists ?? []).length === 0 ? (
        <AppText variant="body" color="textSecondary" style={{ marginTop: spacing.lg }}>
          No playlists.
        </AppText>
      ) : (
        (playlists.data?.playlists ?? []).map((p) => (
          <View
            key={p.id}
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceElevated,
                borderRadius: 12,
                padding: spacing.sm,
                marginTop: spacing.xs,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <AppText variant="body" numberOfLines={1}>
                {p.name}
              </AppText>
              <AppText variant="small" color="textSecondary">
                {p.trackCount} songs · user {p.userId.slice(0, 8)} · {p.createdAt.slice(0, 10)}
              </AppText>
            </View>
            <View style={{ flexDirection: 'row', marginTop: spacing.xs }}>
              <AppButton label="Delete" variant="ghost" compact onPress={() => void remove(p.id)} />
            </View>
          </View>
        ))
      )}

      <LoadMoreButton
        hasMore={hasMore}
        loading={playlists.isFetching}
        onPress={() => setPage((p) => p + 1)}
      />
    </View>
  );
}

function AuditPage() {
  const { colors, spacing } = useTheme();
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const audit = useQuery({
    queryKey: ['admin', 'audit', filter, page],
    queryFn: () => adminApi.listAudit(page, PAGE_SIZE, filter),
  });

  const actions = useMemo(() => {
    const set = new Set((audit.data?.entries ?? []).map((e) => e.action.split('.')[0]));
    return [...set];
  }, [audit.data]);

  const total = audit.data?.total ?? 0;
  const hasMore = audit.data ? page * PAGE_SIZE < total : false;

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginTop: spacing.md }}
      >
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {['', ...actions].map((a) => (
            <FilterChip
              key={a || 'all'}
              label={a || 'All'}
              active={filter === a}
              onPress={() => {
                setFilter(a);
                setPage(1);
              }}
            />
          ))}
        </View>
      </ScrollView>

      {audit.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
      ) : (audit.data?.entries ?? []).length === 0 ? (
        <AppText variant="body" color="textSecondary" style={{ marginTop: spacing.lg }}>
          No audit entries.
        </AppText>
      ) : (
        <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
          {audit.data?.entries.map((entry) => (
            <View
              key={entry.id}
              style={[
                styles.card,
                { backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: spacing.sm },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                <Ionicons name="document-text-outline" size={16} color={colors.textMuted} />
                <AppText variant="small" color="accent" style={{ flex: 1 }}>
                  {entry.action}
                </AppText>
                <AppText variant="caption" color="textMuted">
                  {entry.createdAt.slice(0, 16).replace('T', ' ')}
                </AppText>
              </View>
              <AppText variant="caption" color="textMuted">
                actor {entry.actorId.slice(0, 8)} · {entry.targetType}{' '}
                {entry.targetId?.slice(0, 8) ?? ''}
                {entry.ipAddress ? ` · ${entry.ipAddress}` : ''}
              </AppText>
            </View>
          ))}
        </View>
      )}

      <LoadMoreButton
        hasMore={hasMore}
        loading={audit.isFetching}
        onPress={() => setPage((p) => p + 1)}
      />
    </View>
  );
}

function SystemPage() {
  const { colors, spacing } = useTheme();
  const health = useQuery({ queryKey: ['admin', 'system'], queryFn: () => adminApi.getSystem() });
  const caches = useQuery({ queryKey: ['admin', 'caches'], queryFn: () => adminApi.getCaches() });
  const [diagUserId, setDiagUserId] = useState('');
  const diag = useQuery({
    queryKey: ['admin', 'diagnostics', diagUserId.trim()],
    queryFn: () => adminApi.getRecommendationsDiagnostics(diagUserId.trim()),
    enabled: diagUserId.trim().length > 0,
    retry: 0,
  });

  if (health.isLoading || !health.data) {
    return <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />;
  }
  const h = health.data;
  const usedMb =
    h.downloadsDir.usedBytes != null ? (h.downloadsDir.usedBytes / (1024 * 1024)).toFixed(1) : null;
  const memUsedMb = (h.memory.used / (1024 * 1024)).toFixed(0);

  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: spacing.md },
        ]}
      >
        <AppText variant="headline">Runtime</AppText>
        <AppText variant="body" color={h.dbStatus === 'ok' ? 'success' : 'error'}>
          Database: {h.dbStatus}
        </AppText>
        <AppText variant="body">
          Uptime: {Math.floor(h.uptimeSec / 3600)}h {((h.uptimeSec % 3600) / 60) | 0}m
        </AppText>
        <AppText variant="body">Node: {h.nodeVersion}</AppText>
        <AppText variant="body">
          Host: {h.platform}/{h.arch} · {h.cpuCores} cores
        </AppText>
        <AppText variant="body">Process memory: {memUsedMb} MB</AppText>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: spacing.md },
        ]}
      >
        <AppText variant="headline">Downloads storage</AppText>
        <AppText variant="body">
          Path: {h.downloadsDir.path} · {h.downloadsDir.fileCount} files
        </AppText>
        <AppText variant="body">
          Used: {usedMb == null ? 'n/a (unreadable)' : `${usedMb} MB`}
        </AppText>
        <AppText variant="small" color="textSecondary">
          {Object.entries(h.downloadsDir.aversions)
            .map(([ext, n]) => `${ext || 'misc'} × ${n}`)
            .join(' · ')}
        </AppText>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: spacing.md },
        ]}
      >
        <AppText variant="headline">Caches</AppText>
        <AppText variant="body">Search cache rows: {caches.data?.searchCacheRows ?? '…'}</AppText>
        <AppText variant="body">Lyrics cached: {caches.data?.lyrics ?? '…'}</AppText>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: spacing.md },
        ]}
      >
        <AppText variant="headline">Recommendations diagnostics</AppText>
        <AppText variant="small" color="textSecondary">
          Runs the ranking engine for a user id and shows how it decided.
        </AppText>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
          <TextInput
            value={diagUserId}
            onChangeText={setDiagUserId}
            placeholder="User id"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              {
                flex: 1,
                backgroundColor: colors.surface,
                borderRadius: 8,
                color: colors.textPrimary,
              },
            ]}
          />
          <AppButton
            label="Run"
            compact
            disabled={!diagUserId.trim()}
            onPress={() => void diag.refetch()}
          />
        </View>
        {diag.isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.sm }} />
        ) : diag.data ? (
          <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
            <AppText variant="body">
              {diag.data.personalized ? 'Personalized' : 'Global-only'} · known artists{' '}
              {diag.data.signal.knownArtists} · play stat tracks {diag.data.signal.playStatsTracks}{' '}
              · discovery {Math.round(diag.data.signal.discoveryPreference * 100)}%
            </AppText>
            <AppText variant="small" color="textSecondary">
              Thumbs: {diag.data.signal.thumbsUp}▲ / {diag.data.signal.thumbsDown}▼ · hidden{' '}
              {diag.data.signal.hiddenTracks}t / {diag.data.signal.hiddenArtists}a · favorites{' '}
              {diag.data.signal.favoriteTracks} · downloaded {diag.data.signal.downloadedTracks}
            </AppText>
            {diag.data.seeds.topGenres.length > 0 ? (
              <AppText variant="small" color="textSecondary">
                Top genres:{' '}
                {diag.data.seeds.topGenres
                  .slice(0, 4)
                  .map((g) => `#${g.genreId} (${g.score.toFixed(2)})`)
                  .join(' · ')}
              </AppText>
            ) : null}
            {diag.data.learning.suppressedGenres.length > 0 ? (
              <AppText variant="small" color="error">
                Suppressed genres:{' '}
                {diag.data.learning.suppressedGenres
                  .map((g) => `#${g.genreId} × ${g.count}`)
                  .join(' · ')}
              </AppText>
            ) : null}
            {diag.data.learning.excludedArtists.length > 0 ? (
              <AppText variant="small" color="textSecondary">
                Excluded artists: {diag.data.learning.excludedArtists.slice(0, 5).join(', ')}
              </AppText>
            ) : null}
            <AppText variant="small" color="textSecondary">
              Excluded tracks: {diag.data.learning.excludedTrackCount}
            </AppText>
            {diag.data.sections.length > 0 ? (
              <View style={{ marginTop: spacing.xs, gap: spacing.xxs }}>
                {diag.data.sections.map((s) => (
                  <AppText
                    key={`${s.index}:${s.title}`}
                    variant="caption"
                    color="textMuted"
                    numberOfLines={1}
                  >
                    #{s.index} {s.kind} · {s.title} — {s.size} tracks ({s.fresh} fresh / {s.known}{' '}
                    known{s.thumbsUpBoosted > 0 ? ` / ${s.thumbsUpBoosted}▲` : ''})
                  </AppText>
                ))}
              </View>
            ) : null}
          </View>
        ) : diag.isError ? (
          <AppText variant="small" color="error" style={{ marginTop: spacing.sm }}>
            {diagUserId.trim() ? 'Could not load diagnostics for that user.' : ''}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

function ReliabilityPage() {
  const { colors, spacing } = useTheme();
  const [days, setDays] = useState(30);
  const rel = useQuery({
    queryKey: ['admin', 'reliability', days],
    queryFn: () => adminApi.getReliability(days),
  });

  const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`);

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md }}>
        {[7, 30, 90].map((d) => (
          <FilterChip key={d} label={`${d}d`} active={days === d} onPress={() => setDays(d)} />
        ))}
      </View>

      {rel.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
      ) : rel.data ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <StatRow label="Playback completion" value={pct(rel.data.rates.playbackCompletionRate)} />
          <StatRow
            label="Download success vs searches"
            value={pct(rel.data.rates.downloadCompletionRate)}
          />
          <StatRow label="Lyrics matched vs searches" value={pct(rel.data.rates.lyricsMatchRate)} />

          <View
            style={[
              styles.card,
              { backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: spacing.md },
            ]}
          >
            <AppText variant="headline">Opt-in events ({days}d)</AppText>
            <AppText variant="body">Searches: {rel.data.totals.searches}</AppText>
            <AppText variant="body">Playback starts: {rel.data.totals.playbackStarts}</AppText>
            <AppText variant="body">
              Playback completes: {rel.data.totals.playbackCompletes}
            </AppText>
            <AppText variant="body">
              Downloads completed: {rel.data.totals.downloadsCompleted}
            </AppText>
            <AppText variant="body">Lyrics matched: {rel.data.totals.lyricsMatched}</AppText>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  const { colors, spacing } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: spacing.sm },
      ]}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText variant="body" color="textSecondary">
          {label}
        </AppText>
        <AppText variant="body">{value}</AppText>
      </View>
    </View>
  );
}

export function AdminScreen() {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [page, setPage] = useState<AdminPage>('overview');
  const [period, setPeriod] = useState<Period>(7);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background, flex: 1 }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
    >
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <AppText variant="display">Admin</AppText>
      </View>

      <PageTabs active={page} onSelect={setPage} />

      {page === 'overview' ? <OverviewPage period={period} onPeriod={setPeriod} /> : null}
      {page === 'users' ? <UsersPage /> : null}
      {page === 'downloads' ? <DownloadsPage /> : null}
      {page === 'devices' ? <DevicesPage /> : null}
      {page === 'playlists' ? <PlaylistsPage /> : null}
      {page === 'audit' ? <AuditPage /> : null}
      {page === 'system' ? <SystemPage /> : null}
      {page === 'reliability' ? <ReliabilityPage /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backButton: {
    width: 32,
  },
  tab: {
    alignItems: 'center',
  },
  periodPill: {
    alignItems: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  statCard: {
    width: '30%',
    padding: 10,
    gap: 2,
  },
  card: {
    gap: 4,
  },
  input: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  errorBox: {
    marginTop: 12,
  },
  pressed: {
    opacity: 0.7,
  },
});
