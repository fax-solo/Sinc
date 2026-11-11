import { useCallback } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { IconButton, PrimaryButton } from '../components/Buttons';
import { toast } from '../components/Overlays';
import { colors, radii, spacing } from '../theme';
import { APP_VERSION } from '../../services/updates/appUpdates';
import { useUpdateStore } from '../../features/updates/updateStore';
import type { RootStackParamList } from '../../app/navigation/types';

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function AboutScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const latest = useUpdateStore((state) => state.latest);
  const softStatus = useUpdateStore((state) => state.softStatus);
  const checkSoft = useUpdateStore((state) => state.checkSoft);
  const checking = softStatus === 'checking';

  const download = useCallback(() => {
    if (!latest) return;
    void Linking.openURL(latest.apkUrl).catch(() =>
      toast('Could not open the download link', 'error')
    );
  }, [latest]);

  const statusText =
    softStatus === 'checking'
      ? 'Checking for updates…'
      : softStatus === 'available'
        ? `Version ${latest?.versionName ?? 'new'} is available`
        : softStatus === 'error'
          ? 'Could not check for updates'
          : softStatus === 'idle'
            ? 'Update status not checked yet'
            : 'Sinc is up to date';

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
            marginBottom: spacing.xl,
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
            <Text variant="headline">About & updates</Text>
            <Text variant="caption">Version {APP_VERSION}</Text>
          </View>
        </View>

        <View style={{ alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl }}>
          <View
            style={{
              width: 82,
              height: 82,
              borderRadius: 24,
              backgroundColor: colors.accentSoft,
              borderWidth: 1,
              borderColor: 'rgba(30,215,96,0.25)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="musical-notes" size={38} color={colors.accent} />
          </View>
          <Text variant="title">Sinc</Text>
          <Text variant="caption">A private, on-device music player</Text>
        </View>

        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: radii.lg,
            padding: spacing.md,
            gap: spacing.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor:
                  softStatus === 'available'
                    ? colors.accentSoft
                    : softStatus === 'error'
                      ? 'rgba(255,91,101,0.14)'
                      : colors.input,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name={
                  softStatus === 'available'
                    ? 'rocket-outline'
                    : softStatus === 'error'
                      ? 'alert-circle-outline'
                      : softStatus === 'idle'
                        ? 'time-outline'
                        : 'checkmark-circle-outline'
                }
                size={19}
                color={
                  softStatus === 'available'
                    ? colors.accent
                    : softStatus === 'error'
                      ? colors.error
                      : colors.textSecondary
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{statusText}</Text>
              {latest ? (
                <Text variant="caption">
                  Latest release {latest.versionName}
                  {formatDate(latest.publishedAt) ? ` · ${formatDate(latest.publishedAt)}` : ''}
                </Text>
              ) : null}
            </View>
          </View>

          {softStatus === 'available' && latest ? (
            <>
              {latest.notes ? (
                <View style={{ gap: 4 }}>
                  <Text variant="micro">RELEASE NOTES</Text>
                  <Text variant="small" style={{ lineHeight: 20 }}>
                    {latest.notes}
                  </Text>
                </View>
              ) : null}
              <PrimaryButton
                label="Download update"
                icon="download-outline"
                onPress={download}
              />
            </>
          ) : null}

          <PrimaryButton
            label={checking ? 'Checking…' : 'Check for updates'}
            variant="secondary"
            loading={checking}
            onPress={() => void checkSoft()}
          />
        </View>

        <View
          style={{
            marginTop: spacing.md,
            backgroundColor: colors.card,
            borderRadius: radii.lg,
            padding: spacing.md,
            gap: spacing.sm,
          }}
        >
          <Text variant="bodyStrong">How updates work</Text>
          <Text variant="small" style={{ lineHeight: 20 }}>
            Sinc checks the project’s public GitHub releases. When a newer APK is published, it
            appears here and in your notification centre. Updates are installed by Android after
            you download them; Sinc never installs anything silently.
          </Text>
        </View>

        <View
          style={{
            marginTop: spacing.md,
            backgroundColor: colors.card,
            borderRadius: radii.lg,
            padding: spacing.md,
            gap: spacing.sm,
          }}
        >
          <Text variant="bodyStrong">Your data</Text>
          <Text variant="small" style={{ lineHeight: 20 }}>
            Your library, playlists, history, lyrics cache and downloads live on this device. The
            local build has no account backend and does not upload your listening activity.
          </Text>
        </View>

        <Text variant="caption" align="center" style={{ marginTop: spacing.xl }}>
          Sinc · local build · {APP_VERSION}
        </Text>
      </ScrollView>
    </View>
  );
}
