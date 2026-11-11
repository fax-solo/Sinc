import { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { ComponentProps } from 'react';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { IconButton } from '../components/Buttons';
import { colors, radii, spacing } from '../theme';
import { useAuthStore } from '../../features/auth/authStore';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { useNotificationStore, selectUnreadCount } from '../../features/notifications/notificationStore';
import { useLockStore } from '../../features/lock/lockStore';
import type { RootStackParamList } from '../../app/navigation/types';

function ListRow({
  icon,
  title,
  detail,
  badge,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  detail?: string;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}${badge ? `, ${badge} unread` : ''}`}
      style={({ pressed }) => ({
        minHeight: 58,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        backgroundColor: colors.card,
        borderRadius: radii.md,
        paddingHorizontal: spacing.md,
        opacity: pressed ? 0.68 : 1,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: colors.input,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={17} color={colors.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{title}</Text>
        {detail ? (
          <Text variant="caption" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {badge ? (
        <View
          style={{
            minWidth: 20,
            height: 20,
            borderRadius: 10,
            paddingHorizontal: 5,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: '800', color: colors.onAccent }}>
            {badge > 9 ? '9+' : badge}
          </Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
    </Pressable>
  );
}

export function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((state) => state.user);
  const favorites = useLibraryStore((state) => state.favoriteTracks);
  const playlists = useLibraryStore((state) => state.playlists);
  const playStats = useLibraryStore((state) => state.playStats);
  const artistPlayStats = useLibraryStore((state) => state.artistPlayStats);
  const downloads = useDownloadsStore((state) => state.downloads);
  const unread = useNotificationStore(selectUnreadCount);
  const lockEnabled = useLockStore((state) => state.enabled);

  const completed = downloads.filter((record) => record.phase === 'completed' && record.localUri);
  const totalPlays = useMemo(
    () => Object.values(playStats).reduce((sum, value) => sum + value.count, 0),
    [playStats]
  );
  const topArtist = useMemo(() => {
    const entries = Object.entries(artistPlayStats).sort((a, b) => b[1] - a[1]);
    return entries[0] ?? null;
  }, [artistPlayStats]);
  const initials = user.username.slice(0, 2).toUpperCase();

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
            justifyContent: 'space-between',
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
          <Text variant="micro">YOUR PROFILE</Text>
          <IconButton
            icon="settings-outline"
            label="Settings"
            size={38}
            background={colors.card}
            onPress={() => navigation.navigate('Settings')}
          />
        </View>

        <View style={{ alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl }}>
          <View
            style={{
              width: 92,
              height: 92,
              borderRadius: 46,
              backgroundColor: colors.accentSoft,
              borderWidth: 2,
              borderColor: 'rgba(30,215,96,0.35)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 30, fontWeight: '800', color: colors.accentBright }}>
              {initials}
            </Text>
          </View>
          <Text variant="title">{user.username}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="phone-portrait-outline" size={13} color={colors.textMuted} />
            <Text variant="caption">Local profile · this device</Text>
          </View>
          {topArtist ? (
            <Text variant="small" align="center">
              Most played: <Text variant="small" style={{ color: colors.text }}>{topArtist[0]}</Text>
              {' · '}
              {topArtist[1]} play{topArtist[1] === 1 ? '' : 's'}
            </Text>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xl }}>
          <Stat value={totalPlays} label="Plays" />
          <Stat value={favorites.length} label="Liked" />
          <Stat value={playlists.length} label="Playlists" />
          <Stat value={completed.length} label="Offline" />
        </View>

        <Text variant="micro" style={{ marginBottom: spacing.xs }}>
          YOUR MUSIC
        </Text>
        <View style={{ gap: spacing.xs, marginBottom: spacing.xl }}>
          <ListRow
            icon="heart-outline"
            title="Liked Songs"
            detail={`${favorites.length} song${favorites.length === 1 ? '' : 's'}`}
            onPress={() =>
              navigation.navigate('Main', {
                screen: 'Library',
                params: { category: 'Liked' },
              })
            }
          />
          <ListRow
            icon="list-outline"
            title="Playlists"
            detail={`${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`}
            onPress={() =>
              navigation.navigate('Main', {
                screen: 'Library',
                params: { category: 'Playlists' },
              })
            }
          />
          <ListRow
            icon="time-outline"
            title="Recently played"
            detail="Listening history on this device"
            onPress={() => navigation.navigate('RecentlyPlayed')}
          />
          <ListRow
            icon="download-outline"
            title="Downloads"
            detail={`${completed.length} available offline`}
            onPress={() => navigation.navigate('Downloads')}
          />
          <ListRow
            icon="notifications-outline"
            title="Notifications"
            detail="Downloads, updates and imports"
            badge={unread}
            onPress={() => navigation.navigate('Notifications')}
          />
        </View>

        <Text variant="micro" style={{ marginBottom: spacing.xs }}>
          APP
        </Text>
        <View style={{ gap: spacing.xs }}>
          <ListRow
            icon="musical-notes-outline"
            title="Import from Spotify"
            detail="Bring public playlists into Sinc"
            onPress={() => navigation.navigate('SpotifyImport')}
          />
          <ListRow
            icon="lock-closed-outline"
            title="Privacy, security & analytics"
            detail={lockEnabled ? 'App lock is on' : 'App lock is off'}
            onPress={() => navigation.navigate('Security')}
          />
          <ListRow
            icon="settings-outline"
            title="Settings"
            detail="Notifications, storage and updates"
            onPress={() => navigation.navigate('Settings')}
          />
          <ListRow
            icon="information-circle-outline"
            title="About Sinc"
            detail="Version, updates and data policy"
            onPress={() => navigation.navigate('About')}
          />
        </View>

        <Text variant="caption" align="center" style={{ marginTop: spacing.xl, lineHeight: 17 }}>
          No account. No cloud. Just your music, kept on this device.
        </Text>
      </ScrollView>
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        gap: 2,
        backgroundColor: colors.card,
        borderRadius: radii.md,
        paddingVertical: spacing.sm,
      }}
    >
      <Text style={{ fontSize: 20, lineHeight: 24, fontWeight: '800', color: colors.text }}>
        {value}
      </Text>
      <Text variant="caption">{label}</Text>
    </View>
  );
}
