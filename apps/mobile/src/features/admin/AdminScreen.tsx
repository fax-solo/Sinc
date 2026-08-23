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
  type AdminUserAction,
  type AdminUserRow,
} from '../../api/admin';

type AdminPage = 'overview' | 'users' | 'playlists' | 'audit' | 'mfa';
type Period = 7 | 30 | 90;

const PERIODS: Period[] = [7, 30, 90];

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
    { id: 'playlists', label: 'Playlists', icon: 'musical-notes' },
    { id: 'audit', label: 'Audit', icon: 'document-text' },
    { id: 'mfa', label: 'MFA', icon: 'shield-checkmark' },
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

function UsersPage() {
  const { colors, spacing, radii } = useTheme();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [otp, setOtp] = useState('');
  const [pendingAction, setPendingAction] = useState<{
    user: AdminUserRow;
    action: AdminUserAction;
  } | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionsFor, setSessionsFor] = useState<AdminUserRow | null>(null);

  const debouncedQuery = useDebounced(query);
  const users = useQuery({
    queryKey: ['admin', 'users', debouncedQuery],
    queryFn: () => adminApi.listUsers(1, 30, debouncedQuery),
  });
  const sessions = useQuery({
    queryKey: ['admin', 'sessions', sessionsFor?.id ?? ''],
    queryFn: () => adminApi.listSessions(sessionsFor?.id ?? ''),
    enabled: Boolean(sessionsFor),
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
  }, [queryClient]);

  const mfa = useQuery({ queryKey: ['admin', 'mfa'], queryFn: () => adminApi.getMfaStatus() });

  const runAction = useCallback(
    async (user: AdminUserRow, action: AdminUserAction) => {
      setError(null);
      try {
        if (action === 'delete') {
          await adminApi.deleteUser(user.id, { otp });
        } else {
          const result = await adminApi.actOnUser(user.id, action, { otp });
          if (action === 'reset-password') setResetToken(result.token ?? null);
        }
        setOtp('');
        setPendingAction(null);
        invalidate();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed');
      }
    },
    [otp, invalidate]
  );

  const onActionPress = useCallback(
    (user: AdminUserRow, action: AdminUserAction) => {
      setResetToken(null);
      if (mfa.data?.enabled) {
        setPendingAction({ user, action });
      } else {
        void runAction(user, action);
      }
    },
    [mfa.data, runAction]
  );

  const actionLabel = pendingAction
    ? `${pendingAction.action} ${pendingAction.user.username}?`
    : '';

  return (
    <View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search email / username"
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            backgroundColor: colors.surfaceElevated,
            borderRadius: radii.sm,
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
              borderRadius: radii.sm,
              padding: spacing.sm,
              marginTop: spacing.sm,
            },
          ]}
        >
          <AppText color="onAccent">{error}</AppText>
        </View>
      ) : null}

      {pendingAction ? (
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceElevated,
              borderRadius: radii.md,
              padding: spacing.sm,
              marginTop: spacing.sm,
            },
          ]}
        >
          <AppText variant="body">{actionLabel}</AppText>
          <AppText variant="small" color="textSecondary">
            Enter your authenticator code to confirm.
          </AppText>
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
            <TextInput
              value={otp}
              onChangeText={setOtp}
              placeholder="6-digit code"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              maxLength={6}
              style={[
                styles.input,
                {
                  flex: 1,
                  backgroundColor: colors.surface,
                  borderRadius: radii.sm,
                  color: colors.textPrimary,
                },
              ]}
            />
            <AppButton
              label="Confirm"
              disabled={otp.length !== 6}
              onPress={() =>
                pendingAction && void runAction(pendingAction.user, pendingAction.action)
              }
            />
            <AppButton label="Cancel" variant="ghost" onPress={() => setPendingAction(null)} />
          </View>
        </View>
      ) : null}

      {resetToken ? (
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceElevated,
              borderRadius: radii.md,
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
                borderRadius: radii.md,
                padding: spacing.sm,
                marginTop: spacing.xs,
              },
            ]}
          >
            <Pressable onPress={() => setSessionsFor(sessionsFor?.id === user.id ? null : user)}>
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
                  onPress={() => onActionPress(user, 'demote')}
                />
              ) : (
                <AppButton
                  label="Promote"
                  variant="ghost"
                  compact
                  onPress={() => onActionPress(user, 'promote')}
                />
              )}
              {user.status === 'suspended' ? (
                <AppButton
                  label="Unsuspend"
                  variant="ghost"
                  compact
                  onPress={() => onActionPress(user, 'unsuspend')}
                />
              ) : (
                <AppButton
                  label="Suspend"
                  variant="ghost"
                  compact
                  onPress={() => onActionPress(user, 'suspend')}
                />
              )}
              <AppButton
                label="Reset pw"
                variant="ghost"
                compact
                onPress={() => onActionPress(user, 'reset-password')}
              />
              <AppButton
                label="Delete"
                variant="ghost"
                compact
                onPress={() => onActionPress(user, 'delete')}
              />
            </View>

            {sessionsFor?.id === user.id ? (
              <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
                {sessions.isLoading ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  (sessions.data?.sessions ?? []).map((s) => (
                    <View
                      key={s.id}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
                    >
                      <Ionicons name="phone-portrait-outline" size={14} color={colors.textMuted} />
                      <AppText
                        variant="small"
                        color="textSecondary"
                        numberOfLines={1}
                        style={{ flex: 1 }}
                      >
                        {s.userAgent ?? 'Unknown device'} · {s.ipAddress ?? 'no IP'} ·{' '}
                        {s.createdAt.slice(0, 16).replace('T', ' ')}
                        {s.revokedAt ? ' · revoked' : ''}
                      </AppText>
                      {!s.revokedAt ? (
                        <AppButton
                          label="Revoke"
                          variant="ghost"
                          compact
                          onPress={() =>
                            void adminApi.revokeSession(s.id, { otp }).then(invalidate)
                          }
                        />
                      ) : null}
                    </View>
                  ))
                )}
              </View>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}

function PlaylistsPage() {
  const { colors, spacing, radii } = useTheme();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);

  const debouncedQuery = useDebounced(query);
  const playlists = useQuery({
    queryKey: ['admin', 'playlists', debouncedQuery],
    queryFn: () => adminApi.listPlaylists(1, 30, debouncedQuery),
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'playlists'] });
  }, [queryClient]);

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await adminApi.deletePlaylist(id, { otp });
        setOtp('');
        invalidate();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Delete failed');
      }
    },
    [otp, invalidate]
  );

  return (
    <View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search playlists"
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            backgroundColor: colors.surfaceElevated,
            borderRadius: radii.sm,
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
              borderRadius: radii.sm,
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
      ) : (
        (playlists.data?.playlists ?? []).map((p) => (
          <View
            key={p.id}
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceElevated,
                borderRadius: radii.md,
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
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
              <TextInput
                value={otp}
                onChangeText={setOtp}
                placeholder="OTP if enabled"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                style={[
                  styles.input,
                  {
                    flex: 1,
                    backgroundColor: colors.surface,
                    borderRadius: radii.sm,
                    color: colors.textPrimary,
                  },
                ]}
              />
              <AppButton label="Delete" variant="ghost" compact onPress={() => void remove(p.id)} />
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function AuditPage() {
  const { colors, spacing, radii } = useTheme();
  const [filter, setFilter] = useState('');
  const audit = useQuery({
    queryKey: ['admin', 'audit', filter],
    queryFn: () => adminApi.listAudit(1, 50),
  });

  const entries = useMemo(() => {
    const all = audit.data?.entries ?? [];
    if (!filter) return all;
    return all.filter((e) => e.action.includes(filter));
  }, [audit.data, filter]);

  const actions = useMemo(() => {
    const set = new Set((audit.data?.entries ?? []).map((e) => e.action.split('.')[0]));
    return [...set];
  }, [audit.data]);

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginTop: spacing.md }}
      >
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          <Pressable
            onPress={() => setFilter('')}
            style={({ pressed }) => [
              styles.tab,
              {
                backgroundColor: filter === '' ? colors.accent : colors.surfaceElevated,
                borderRadius: radii.full,
                paddingVertical: spacing.xxs,
                paddingHorizontal: spacing.md,
              },
              pressed && styles.pressed,
            ]}
          >
            <AppText
              variant="small"
              style={{ color: filter === '' ? colors.onAccent : colors.textSecondary }}
            >
              All
            </AppText>
          </Pressable>
          {actions.map((a) => (
            <Pressable
              key={a}
              onPress={() => setFilter(filter === a ? '' : a)}
              style={({ pressed }) => [
                styles.tab,
                {
                  backgroundColor: filter === a ? colors.accent : colors.surfaceElevated,
                  borderRadius: radii.full,
                  paddingVertical: spacing.xxs,
                  paddingHorizontal: spacing.md,
                },
                pressed && styles.pressed,
              ]}
            >
              <AppText
                variant="small"
                style={{ color: filter === a ? colors.onAccent : colors.textSecondary }}
              >
                {a}
              </AppText>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {audit.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
      ) : (
        <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
          {entries.map((entry) => (
            <View
              key={entry.id}
              style={[
                styles.card,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderRadius: radii.md,
                  padding: spacing.sm,
                },
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
    </View>
  );
}

function MfaPage() {
  const { colors, spacing, radii } = useTheme();
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mfa = useQuery({ queryKey: ['admin', 'mfa'], queryFn: () => adminApi.getMfaStatus() });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
  }, [queryClient]);

  const enroll = useCallback(async () => {
    setError(null);
    try {
      const res = await adminApi.mfaEnroll();
      setSecret(res.secret);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enrollment failed');
    }
  }, []);

  const verify = useCallback(async () => {
    setError(null);
    try {
      await adminApi.mfaVerify(code);
      setCode('');
      setSecret(null);
      invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    }
  }, [code, invalidate]);

  const disable = useCallback(async () => {
    setError(null);
    try {
      await adminApi.mfaDisable(code);
      setCode('');
      invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Disable failed');
    }
  }, [code, invalidate]);

  return (
    <View style={{ marginTop: spacing.md }}>
      {error ? (
        <View
          style={[
            styles.errorBox,
            {
              backgroundColor: colors.error,
              borderRadius: radii.sm,
              padding: spacing.sm,
              marginBottom: spacing.sm,
            },
          ]}
        >
          <AppText color="onAccent">{error}</AppText>
        </View>
      ) : null}

      {secret ? (
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
          <AppText variant="headline">Scan or type this secret</AppText>
          <AppText variant="small" color="textSecondary" style={{ marginTop: spacing.xxs }}>
            Add it to your authenticator app, then enter a code to enable MFA.
          </AppText>
          <View style={{ marginTop: spacing.sm }}>
            <AppText variant="body" selectable>
              {secret}
            </AppText>
          </View>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="6-digit code"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            maxLength={6}
            style={[
              styles.input,
              {
                backgroundColor: colors.surface,
                borderRadius: radii.sm,
                color: colors.textPrimary,
                marginTop: spacing.sm,
              },
            ]}
          />
          <AppButton
            label="Enable MFA"
            onPress={() => void verify()}
            disabled={code.length !== 6}
            style={{ marginTop: spacing.sm }}
          />
        </View>
      ) : (
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
          <AppText variant="headline">Two-factor authentication</AppText>
          <AppText variant="body" color="textSecondary" style={{ marginTop: spacing.xxs }}>
            {mfa.data?.enabled
              ? 'MFA is enabled — destructive admin actions require a code from your authenticator app.'
              : 'MFA is off. Enabling it protects every destructive admin action with a time-based one-time code.'}
          </AppText>
          {mfa.data?.enabled ? (
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="6-digit code"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                style={[
                  styles.input,
                  {
                    flex: 1,
                    backgroundColor: colors.surface,
                    borderRadius: radii.sm,
                    color: colors.textPrimary,
                  },
                ]}
              />
              <AppButton
                label="Disable"
                variant="ghost"
                onPress={() => void disable()}
                disabled={code.length !== 6}
              />
            </View>
          ) : (
            <AppButton
              label="Set up MFA"
              onPress={() => void enroll()}
              style={{ marginTop: spacing.sm }}
            />
          )}
        </View>
      )}
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
      {page === 'playlists' ? <PlaylistsPage /> : null}
      {page === 'audit' ? <AuditPage /> : null}
      {page === 'mfa' ? <MfaPage /> : null}
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
