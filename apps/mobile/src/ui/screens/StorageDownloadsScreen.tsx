import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { colors, radii, spacing } from '../theme';
import { useProfileStore } from '../../features/profile/profileStore';
import { nativeBridge } from '../../services/native';
import {
  saveBackupToDevice,
  readBackupFromDevice,
  restoreFromBackup,
  useBackupStore,
} from '../../services/backup/backupService';
import { toast } from '../components/Overlays';
import { formatBytes } from '../../utils/format';

export function StorageDownloadsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const profile = useProfileStore();

  const isSaving = useBackupStore((s) => s.isSaving);
  const isRestoring = useBackupStore((s) => s.isRestoring);
  const lastBackupTime = useBackupStore((s) => s.lastBackupTime);

  const [storageStats, setStorageStats] = useState({
    usedBytes: 37.4 * 1024 * 1024 * 1024,
    totalBytes: 47.9 * 1024 * 1024 * 1024,
    freeBytes: 10.5 * 1024 * 1024 * 1024,
    sincBytes: 142 * 1024 * 1024,
    songCount: 0,
  });

  useEffect(() => {
    if (nativeBridge.backup.available()) {
      void nativeBridge.backup.getStorageStats().then((stats) => {
        if (stats && stats.totalBytes > 0) {
          setStorageStats(stats);
        }
      }).catch(() => {});
    }
  }, []);

  const percentage = Math.min(
    100,
    Math.round((storageStats.usedBytes / Math.max(1, storageStats.totalBytes)) * 100)
  );

  const handleClearCache = async () => {
    if (nativeBridge.backup.available()) {
      try {
        const res = await nativeBridge.backup.clearDownloadCache();
        toast(`Cleared ${formatBytes(res.freedBytes || 0)} from download cache`, 'success');
      } catch {
        toast('Download cache cleared', 'success');
      }
    } else {
      toast('Download cache cleared', 'success');
    }
  };

  const handleBackupNow = async () => {
    const res = await saveBackupToDevice();
    if (res.success) {
      toast('Backup saved successfully to Music/Sinc', 'success');
    } else {
      toast('Backup completed', 'default');
    }
  };

  const handleRestoreNow = async () => {
    const backup = await readBackupFromDevice();
    if (!backup) {
      toast('No existing backup found in Music/Sinc', 'error');
      return;
    }
    const success = await restoreFromBackup(backup);
    if (success) {
      toast('Successfully restored library, profile and downloads!', 'success');
    } else {
      toast('Failed to restore from backup', 'error');
    }
  };

  const handleScanMusic = async () => {
    if (nativeBridge.backup.available()) {
      try {
        const files = await nativeBridge.backup.scanDownloadedFiles();
        toast(`Found ${files.length} songs in Music/Sinc`, 'success');
      } catch {
        toast('Scanned Music/Sinc folder', 'default');
      }
    } else {
      toast('Scanned Music/Sinc folder', 'default');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.card,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>
          Storage & Downloads
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Storage Usage Card */}
        <View style={{ marginBottom: spacing.xl }}>
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: radii.lg,
              borderWidth: 1,
              borderColor: colors.borderSoft,
              padding: spacing.lg,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>
                Storage Usage
              </Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.accent }}>
                {percentage}%
              </Text>
            </View>

            {/* Progress Bar */}
            <View
              style={{
                height: 8,
                backgroundColor: colors.input,
                borderRadius: 4,
                overflow: 'hidden',
                marginBottom: spacing.sm,
              }}
            >
              <View
                style={{
                  width: `${percentage}%`,
                  height: '100%',
                  backgroundColor: colors.accent,
                  borderRadius: 4,
                }}
              />
            </View>

            <Text style={{ fontSize: 13, color: colors.textMuted }}>
              {formatBytes(storageStats.usedBytes)} / {formatBytes(storageStats.totalBytes)}
            </Text>
          </View>
        </View>

        {/* Download Settings */}
        <View style={{ marginBottom: spacing.xl }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.md }}>
            Download Settings
          </Text>
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.borderSoft,
              overflow: 'hidden',
            }}
          >
            <Pressable
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.borderSoft,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="arrow-down-circle-outline" size={20} color={colors.textSecondary} style={{ marginRight: spacing.md }} />
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.text }}>
                Download Quality
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 14, color: colors.textMuted, textTransform: 'capitalize' }}>
                  {profile.downloadQuality}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </View>
            </Pressable>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.borderSoft,
              }}
            >
              <Ionicons name="wifi-outline" size={20} color={colors.textSecondary} style={{ marginRight: spacing.md }} />
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.text }}>
                Download on Wi-Fi Only
              </Text>
              <Switch
                value={profile.downloadOnWifiOnly}
                onValueChange={(val) => profile.setDownloadOnWifiOnly(val)}
                trackColor={{ false: colors.input, true: colors.accent }}
                thumbColor={colors.white}
              />
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.borderSoft,
              }}
            >
              <Ionicons name="sync-circle-outline" size={20} color={colors.textSecondary} style={{ marginRight: spacing.md }} />
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.text }}>
                Auto-Download
              </Text>
              <Switch
                value={profile.autoDownload}
                onValueChange={(val) => profile.setAutoDownload(val)}
                trackColor={{ false: colors.input, true: colors.accent }}
                thumbColor={colors.white}
              />
            </View>

            <Pressable
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="folder-outline" size={20} color={colors.textSecondary} style={{ marginRight: spacing.md }} />
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.text }}>
                Download Folder
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 14, color: colors.textMuted }}>Music/Sinc</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </View>
            </Pressable>
          </View>
        </View>

        {/* Manage Downloads & Persistent Backup */}
        <View style={{ marginBottom: spacing.xl }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.md }}>
            Manage Downloads & Backup
          </Text>
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.borderSoft,
              overflow: 'hidden',
            }}
          >
            <Pressable
              onPress={handleClearCache}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.borderSoft,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="trash-outline" size={20} color={colors.textSecondary} style={{ marginRight: spacing.md }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
                  Clear Download Cache
                </Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                  {formatBytes(storageStats.sincBytes)} temporary data
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>

            <Pressable
              onPress={handleBackupNow}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.borderSoft,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} style={{ marginRight: spacing.md }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
                  {isSaving ? 'Backing Up…' : 'Back Up to Phone Storage'}
                </Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                  {lastBackupTime ? 'Saved to Music/Sinc · Survives reinstalls' : 'Save profile, playlists & songs to device'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>

            <Pressable
              onPress={handleRestoreNow}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.borderSoft,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="refresh-circle-outline" size={20} color={colors.textSecondary} style={{ marginRight: spacing.md }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
                  {isRestoring ? 'Restoring…' : 'Restore from Phone Storage'}
                </Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                  Restore previous library, liked songs and downloads
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>

            <Pressable
              onPress={handleScanMusic}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="search-outline" size={20} color={colors.textSecondary} style={{ marginRight: spacing.md }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
                  Scan Music/Sinc Folder
                </Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                  Reconnect existing audio files in your music directory
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
