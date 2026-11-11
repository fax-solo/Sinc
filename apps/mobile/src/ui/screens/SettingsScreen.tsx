import { useMemo } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { ComponentProps, ReactNode } from 'react';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { IconButton } from '../components/Buttons';
import { toast } from '../components/Overlays';
import { colors, radii, spacing } from '../theme';
import { usePreferencesStore, type NotificationPreference } from '../../features/preferences/preferencesStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useSearchStore } from '../../features/search/searchStore';
import { useLockStore } from '../../features/lock/lockStore';
import { useNotificationStore } from '../../features/notifications/notificationStore';
import { APP_VERSION } from '../../services/updates/appUpdates';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { formatBytes } from '../../utils/format';
import type { RootStackParamList } from '../../app/navigation/types';

const NOTIFICATION_ROWS: Array<{
  key: NotificationPreference;
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  description: string;
}> = [
  {
    key: 'updates',
    icon: 'cloud-download-outline',
    title: 'App updates',
    description: 'Know when a new Sinc release is available.',
  },
  {
    key: 'downloads',
    icon: 'download-outline',
    title: 'Download results',
    description: 'Completed and failed offline downloads.',
  },
  {
    key: 'imports',
    icon: 'musical-notes-outline',
    title: 'Spotify imports',
    description: 'When an imported playlist is saved to your library.',
  },
];

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const preferences = usePreferencesStore((state) => state.notifications);
  const setNotificationPreference = usePreferencesStore((state) => state.setNotificationPreference);
  const downloads = useDownloadsStore((state) => state.downloads);
  const clearRecent = useSearchStore((state) => state.clearRecent);
  const recentSearches = useSearchStore((state) => state.recentSearches);
  const lockEnabled = useLockStore((state) => state.enabled);
  const notifications = useNotificationStore((state) => state.notifications);
  const clearNotifications = useNotificationStore((state) => state.clear);
  const discoveryPreference = useLibraryStore((state) => state.discoveryPreference);
  const setDiscoveryPreference = useLibraryStore((state) => state.setDiscoveryPreference);
  const thumbsUp = useLibraryStore((state) => state.thumbsUp);
  const thumbsDown = useLibraryStore((state) => state.thumbsDown);
  const hiddenTrackIds = useLibraryStore((state) => state.hiddenTrackIds);
  const hiddenArtistNames = useLibraryStore((state) => state.hiddenArtistNames);
  const clearRecommendationFeedback = useLibraryStore(
    (state) => state.clearRecommendationFeedback
  );

  const completed = downloads.filter((record) => record.phase === 'completed' && record.localUri);
  const storageBytes = completed.reduce((sum, record) => sum + (record.sizeBytes ?? 0), 0);
  const recommendationFeedbackCount =
    Object.keys(thumbsUp).length +
    Object.keys(thumbsDown).length +
    hiddenTrackIds.length +
    hiddenArtistNames.length;
  const unread = useMemo(
    () => notifications.reduce((count, item) => (item.read ? count : count + 1), 0),
    [notifications]
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.xs,
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            marginBottom: spacing.lg,
          }}
        >
          <IconButton
            icon="chevron-back"
            label="Back"
            size={38}
            background={colors.card}
            onPress={() => navigation.goBack()}
          />
          <View style={{ flex: 1 }}>
            <Text variant="headline">Settings</Text>
            <Text variant="caption">Sinc {APP_VERSION} · on this device</Text>
          </View>
        </View>

        <SettingsSection title="Notifications">
          <SettingsRow
            icon="notifications-outline"
            title="Notification centre"
            detail={unread > 0 ? `${unread} unread` : `${notifications.length} saved`}
            onPress={() => navigation.navigate('Notifications')}
          />
          {NOTIFICATION_ROWS.map((row) => (
            <View
              key={row.key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                backgroundColor: colors.card,
                borderRadius: radii.md,
                padding: spacing.md,
              }}
            >
              <Ionicons name={row.icon} size={20} color={colors.textSecondary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{row.title}</Text>
                <Text variant="caption">{row.description}</Text>
              </View>
              <Switch
                value={preferences[row.key]}
                onValueChange={(value) => setNotificationPreference(row.key, value)}
                trackColor={{ true: colors.accent, false: colors.input }}
                thumbColor={colors.white}
                accessibilityLabel={`Toggle ${row.title.toLowerCase()} notifications`}
              />
            </View>
          ))}
          {notifications.length > 0 ? (
            <SettingsRow
              icon="trash-outline"
              title="Clear notification history"
              detail={`${notifications.length} saved`}
              destructive
              onPress={() => {
                clearNotifications();
                toast('Notification history cleared', 'success');
              }}
            />
          ) : null}
        </SettingsSection>

        <SettingsSection title="Library & storage">
          <SettingsRow
            icon="download-outline"
            title="Downloads"
            detail={`${completed.length} songs · ${formatBytes(storageBytes)}`}
            onPress={() => navigation.navigate('Downloads')}
          />
          <SettingsRow
            icon="time-outline"
            title="Clear recent searches"
            detail={recentSearches.length > 0 ? `${recentSearches.length} saved` : 'None saved'}
            disabled={recentSearches.length === 0}
            onPress={() => {
              clearRecent();
              toast('Recent searches cleared', 'success');
            }}
          />
          <SettingsRow
            icon="flash-outline"
            title="Clear temporary stream links"
            detail="Expired provider links are cached for a few hours"
            onPress={() => {
              storage.remove(STORAGE_KEYS.STREAM_CACHE);
              toast('Temporary stream links cleared', 'success');
            }}
          />
        </SettingsSection>

        <SettingsSection title="Privacy & security">
          <SettingsRow
            icon="lock-closed-outline"
            title="App lock & privacy"
            detail={lockEnabled ? 'PIN protection is on' : 'PIN is off'}
            onPress={() => navigation.navigate('Security')}
          />
        </SettingsSection>

        <SettingsSection title="Music">
          <DiscoveryPreference
            value={discoveryPreference}
            onChange={setDiscoveryPreference}
          />
          <SettingsRow
            icon="sparkles-outline"
            title="Reset recommendation feedback"
            detail={
              recommendationFeedbackCount > 0
                ? `${recommendationFeedbackCount} likes, dislikes or hidden items`
                : 'No feedback yet'
            }
            disabled={recommendationFeedbackCount === 0}
            onPress={() => {
              clearRecommendationFeedback();
              toast('Recommendations reset', 'success');
            }}
          />
          <SettingsRow
            icon="musical-notes-outline"
            title="Import from Spotify"
            detail="Save public playlists to Sinc"
            onPress={() => navigation.navigate('SpotifyImport')}
          />
        </SettingsSection>

        <SettingsSection title="About">
          <SettingsRow
            icon="information-circle-outline"
            title="About & updates"
            detail={`Version ${APP_VERSION}`}
            onPress={() => navigation.navigate('About')}
          />
        </SettingsSection>

        <Text variant="caption" align="center" style={{ marginTop: spacing.lg }}>
          Sinc keeps your library on this device. No account required.
        </Text>
      </ScrollView>
    </View>
  );
}

/**
 * Calibrates how much of the personalized mix may be unfamiliar. Home mixes
 * refresh in the background when this changes so the slider is actionable.
 */
function DiscoveryPreference({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const steps = 5;
  const active = Math.round(value * steps);
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: radii.lg,
        padding: spacing.md,
        gap: spacing.sm,
      }}
    >
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}
      >
        <Text variant="bodyStrong">Discovery mix</Text>
        <Text variant="caption" style={{ color: colors.accent, fontWeight: '700' }}>
          {Math.round(value * 100)}% new
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 5 }}>
        {Array.from({ length: steps + 1 }, (_, index) => (
          <Pressable
            key={index}
            onPress={() => onChange(index / steps)}
            accessibilityRole="button"
            accessibilityLabel={`Discovery level ${Math.round((index / steps) * 100)} percent new music`}
            accessibilityState={{ selected: index === active }}
            style={({ pressed }) => ({
              flex: 1,
              height: 30,
              borderRadius: 8,
              backgroundColor: index <= active ? colors.accent : colors.input,
              opacity: pressed ? 0.7 : 1,
            })}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption" style={{ color: colors.textMuted }}>
          More familiar
        </Text>
        <Text variant="caption" style={{ color: colors.textMuted }}>
          More new
        </Text>
      </View>
      <Text variant="small" style={{ color: colors.textSecondary }}>
        Sinc refreshes your Home mixes when you change this.
      </Text>
    </View>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.xl, gap: spacing.xs }}>
      <Text variant="micro" style={{ marginBottom: 2 }}>
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function SettingsRow({
  icon,
  title,
  detail,
  onPress,
  destructive,
  disabled,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  detail?: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => ({
        minHeight: 58,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        backgroundColor: colors.card,
        borderRadius: radii.md,
        paddingHorizontal: spacing.md,
        opacity: disabled ? 0.45 : pressed ? 0.68 : 1,
      })}
    >
      <Ionicons
        name={icon}
        size={20}
        color={destructive ? colors.error : colors.textSecondary}
      />
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="bodyStrong" style={destructive ? { color: colors.error } : undefined}>
          {title}
        </Text>
        {detail ? (
          <Text variant="caption" numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
    </Pressable>
  );
}
