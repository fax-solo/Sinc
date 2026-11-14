import { useState, type ComponentProps } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { IconButton } from '../components/Buttons';
import { ConfirmDialog, toast } from '../components/Overlays';
import { EmptyState } from '../components/State';
import { colors, radii, spacing } from '../theme';
import {
  useNotificationStore,
  selectUnreadCount,
  type AppNotification,
} from '../../features/notifications/notificationStore';
import { useLibraryStore } from '../../services/library/libraryStore';
import type { RootStackParamList } from '../../app/navigation/types';

const iconFor = (kind: AppNotification['kind']): ComponentProps<typeof Ionicons>['name'] =>
  kind === 'update'
    ? 'cloud-download-outline'
    : kind === 'download'
      ? 'download-outline'
      : kind === 'import'
        ? 'musical-notes-outline'
        : 'notifications-outline';

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function NotificationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const notifications = useNotificationStore((state) => state.notifications);
  const unread = useNotificationStore(selectUnreadCount);
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const remove = useNotificationStore((state) => state.remove);
  const clear = useNotificationStore((state) => state.clear);
  const playlists = useLibraryStore((state) => state.playlists);
  const [clearOpen, setClearOpen] = useState(false);

  const open = (notification: AppNotification) => {
    markRead(notification.id);
    const action = notification.action;
    if (!action) return;
    if (action.type === 'updates') navigation.navigate('About');
    else if (action.type === 'downloads') navigation.navigate('Downloads');
    else if (action.type === 'player') navigation.navigate('Player');
    else if (action.type === 'library')
      navigation.navigate('Main', { screen: 'Library' });
    else if (action.type === 'playlist') {
      if (playlists.some((playlist) => playlist.id === action.playlistId)) {
        navigation.navigate('LocalPlaylist', { id: action.playlistId });
      } else {
        toast('That playlist no longer exists', 'default');
      }
    }
  };

  return (
    <Screen padded={false}>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: spacing.xxl + insets.bottom }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                paddingTop: spacing.xs,
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
                <Text variant="headline">Notifications</Text>
                <Text variant="caption">
                  {unread > 0 ? `${unread} unread` : 'You’re all caught up'}
                </Text>
              </View>
              {notifications.length > 0 ? (
                <>
                  <IconButton
                    icon="checkmark-done-outline"
                    label="Mark all as read"
                    size={38}
                    background={colors.card}
                    disabled={unread === 0}
                    onPress={markAllRead}
                  />
                  <IconButton
                    icon="trash-outline"
                    label="Clear notifications"
                    size={38}
                    background={colors.card}
                    color={colors.error}
                    onPress={() => setClearOpen(true)}
                  />
                </>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="notifications-off-outline"
            title="No notifications"
            message="Download results, new releases and imports will show up here."
            actionLabel="Back to Home"
            onAction={() => navigation.navigate('Main', { screen: 'Home' })}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.body}${item.read ? '' : '. Unread'}`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: spacing.sm,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.sm,
              borderRadius: radii.md,
              backgroundColor: item.read ? 'transparent' : colors.accentSoft,
              marginBottom: spacing.xs,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: item.read ? colors.card : 'rgba(30,215,96,0.22)',
              }}
            >
              <Ionicons
                name={iconFor(item.kind)}
                size={19}
                color={item.read ? colors.textSecondary : colors.accent}
              />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                  {item.title}
                </Text>
                {!item.read ? (
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent }} />
                ) : null}
              </View>
              <Text variant="small" style={{ lineHeight: 18 }}>
                {item.body}
              </Text>
              <Text variant="caption" style={{ marginTop: 1 }}>
                {relativeTime(item.createdAt)}
              </Text>
            </View>
            <Pressable
              onPress={(event) => {
                event.stopPropagation();
                remove(item.id);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove notification: ${item.title}`}
              style={({ pressed }) => ({
                width: 28,
                height: 32,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <Ionicons name="close" size={17} color={colors.textMuted} />
            </Pressable>
          </Pressable>
        )}
      />

      <ConfirmDialog
        visible={clearOpen}
        title="Clear all notifications?"
        message="This removes the notification history from this device. Download and library items are not affected."
        confirmLabel="Clear all"
        destructive
        onCancel={() => setClearOpen(false)}
        onConfirm={() => {
          clear();
          setClearOpen(false);
        }}
      />
    </Screen>
  );
}
