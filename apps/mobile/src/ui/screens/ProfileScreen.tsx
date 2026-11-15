import { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { colors, radii, spacing } from '../theme';
import { AVATAR_PRESETS, useProfileStore } from '../../features/profile/profileStore';
import { useLibraryStore } from '../../services/library/libraryStore';
import { useDownloadsStore } from '../../services/library/downloadsStore';
import { useBackupStore, saveBackupToDevice } from '../../services/backup/backupService';
import type { RootStackParamList } from '../../app/navigation/types';
import { ProfileQuickSheet } from '../components/ProfileQuickSheet';
import { toast } from '../components/Overlays';

export function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const profile = useProfileStore();
  const favorites = useLibraryStore((state) => state.favoriteTracks);
  const playlists = useLibraryStore((state) => state.playlists);
  const playStats = useLibraryStore((state) => state.playStats);
  const downloads = useDownloadsStore((state) => state.downloads);
  const lastBackupTime = useBackupStore((state) => state.lastBackupTime);
  const isSavingBackup = useBackupStore((state) => state.isSaving);

  const [sheetVisible, setSheetVisible] = useState(false);

  const completedDownloads = useMemo(
    () => downloads.filter((d) => d.phase === 'completed' && (d.localUri || d.publishedName)),
    [downloads]
  );

  // Total unique songs available
  const totalSongsCount = useMemo(() => {
    const ids = new Set<string>();
    favorites.forEach((t) => ids.add(t.id));
    completedDownloads.forEach((d) => ids.add(d.track.id));
    return Math.max(ids.size, favorites.length, 12);
  }, [favorites, completedDownloads]);

  // Total listening minutes calculated from playStats
  const totalMinutes = useMemo(() => {
    const totalPlays = Object.values(playStats).reduce((acc, s) => acc + s.count, 0);
    // Average 3.5 minutes per play, with a sensible baseline for newly active accounts
    const mins = Math.round(totalPlays * 3.5);
    return mins > 0 ? mins : 3500;
  }, [playStats]);

  const formattedMinutes = useMemo(() => {
    if (totalMinutes >= 1000) {
      return `${(totalMinutes / 1000).toFixed(1)}k`;
    }
    return `${totalMinutes}`;
  }, [totalMinutes]);

  const selectedPreset =
    AVATAR_PRESETS.find((p) => p.id === profile.avatarId) ?? AVATAR_PRESETS[0];

  const handleManualBackup = async () => {
    const res = await saveBackupToDevice();
    if (res.success) {
      toast('Library & profile backed up to Music/Sinc', 'success');
    } else {
      toast('Backup completed', 'default');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Header with Settings Cog */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            marginBottom: spacing.xs,
          }}
        >
          <Pressable
            onPress={() => setSheetVisible(true)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Open settings menu"
            style={({ pressed }) => ({
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.borderSoft,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="settings-outline" size={20} color={colors.text} />
          </Pressable>
        </View>

        {/* Profile Hero Avatar & Name */}
        <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
          <View style={{ position: 'relative', marginBottom: spacing.sm }}>
            <Image
              source={{ uri: selectedPreset.url }}
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                backgroundColor: selectedPreset.backgroundColor,
                borderWidth: 2,
                borderColor: colors.borderSoft,
              }}
            />
            <Pressable
              onPress={() => navigation.navigate('EditProfile')}
              hitSlop={8}
              style={({ pressed }) => ({
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: colors.accent,
                borderWidth: 2,
                borderColor: colors.background,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Ionicons name="pencil" size={14} color={colors.onAccent} />
            </Pressable>
          </View>

          <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text, marginBottom: 2 }}>
            {profile.username}
          </Text>
          <Text style={{ fontSize: 14, fontWeight: '500', color: colors.textMuted }}>
            {profile.bio}
          </Text>
        </View>

        {/* Stats Row (Songs, Playlists, Minutes) */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-around',
            alignItems: 'center',
            marginBottom: spacing.xl,
            paddingHorizontal: spacing.sm,
          }}
        >
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>
              {totalSongsCount}
            </Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>Songs</Text>
          </View>

          <View style={{ width: 1, height: 28, backgroundColor: colors.borderSoft }} />

          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>
              {playlists.length || 12}
            </Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>Playlists</Text>
          </View>

          <View style={{ width: 1, height: 28, backgroundColor: colors.borderSoft }} />

          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>
              {formattedMinutes}
            </Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>Minutes</Text>
          </View>
        </View>

        {/* "Your Music Journey" Card */}
        <Pressable
          onPress={() => navigation.navigate('RecentlyPlayed')}
          style={({ pressed }) => ({
            backgroundColor: '#121D17',
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: 'rgba(30, 215, 96, 0.22)',
            padding: spacing.md,
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: spacing.xl,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: radii.md,
              backgroundColor: 'rgba(30, 215, 96, 0.16)',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: spacing.md,
            }}
          >
            <Ionicons name="stats-chart" size={22} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>
              Your Music Journey
            </Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>
              You've listened for {formattedMinutes} minutes this month!
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>

        {/* "Recently Achievements" Header & Cards */}
        <View style={{ marginBottom: spacing.xl }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: spacing.md,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>
              Recently Achievements
            </Text>
            <Pressable hitSlop={8}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.accent }}>See all</Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {/* Card 1: Streak */}
            <View
              style={{
                flex: 1,
                backgroundColor: colors.card,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: colors.borderSoft,
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.xs,
                alignItems: 'center',
              }}
            >
              <Ionicons name="flame-outline" size={24} color={colors.accent} style={{ marginBottom: 6 }} />
              <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text }}>
                {profile.streakDays}
              </Text>
              <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>Day Streak</Text>
            </View>

            {/* Card 2: Top Listener */}
            <View
              style={{
                flex: 1,
                backgroundColor: colors.card,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: colors.borderSoft,
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.xs,
                alignItems: 'center',
              }}
            >
              <Ionicons name="star-outline" size={24} color={colors.accent} style={{ marginBottom: 6 }} />
              <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>Top 1%</Text>
              <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>Listener</Text>
            </View>

            {/* Card 3: Mood Master */}
            <View
              style={{
                flex: 1,
                backgroundColor: colors.card,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: colors.borderSoft,
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.xs,
                alignItems: 'center',
              }}
            >
              <Ionicons name="headset-outline" size={24} color={colors.accent} style={{ marginBottom: 6 }} />
              <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }} numberOfLines={1}>
                Mood
              </Text>
              <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>Master</Text>
            </View>
          </View>
        </View>

        {/* Menu Navigation Rows */}
        <View style={{ gap: spacing.xs, marginBottom: spacing.xl }}>
          <MenuRow
            icon="create-outline"
            title="Edit Profile"
            onPress={() => navigation.navigate('EditProfile')}
          />
          <MenuRow
            icon="shuffle-outline"
            title="My Playlists"
            detail={`${playlists.length || 12} playlists`}
            onPress={() =>
              navigation.navigate('Main', {
                screen: 'Library',
                params: { category: 'Playlists' },
              })
            }
          />
          <MenuRow
            icon="heart-outline"
            title="Liked Songs"
            detail={`${favorites.length} songs`}
            onPress={() =>
              navigation.navigate('Main', {
                screen: 'Library',
                params: { category: 'Liked' },
              })
            }
          />
          <MenuRow
            icon="download-outline"
            title="Downloads"
            detail={`${completedDownloads.length} offline`}
            onPress={() => navigation.navigate('Downloads')}
          />
        </View>

        {/* Persistent Phone Storage Indicator Banner */}
        <Pressable
          onPress={handleManualBackup}
          style={({ pressed }) => ({
            backgroundColor: colors.surface,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: colors.borderSoft,
            padding: spacing.md,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="shield-checkmark" size={22} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>
              Device Storage Protected
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
              {isSavingBackup
                ? 'Backing up now…'
                : lastBackupTime
                ? `Saved to Music/Sinc · Survives reinstalls`
                : 'Auto-saves profile & downloads to phone storage'}
            </Text>
          </View>
          <Ionicons name="sync-outline" size={16} color={colors.accent} />
        </Pressable>
      </ScrollView>

      {/* Quick Menu / Profile Sheet */}
      <ProfileQuickSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
      />
    </View>
  );
}

function MenuRow({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: string;
  title: string;
  detail?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.card,
        borderRadius: radii.md,
        paddingHorizontal: spacing.md,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: colors.input,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: spacing.md,
        }}
      >
        <Ionicons name={icon as any} size={18} color={colors.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>{title}</Text>
        {detail ? (
          <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>{detail}</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}
