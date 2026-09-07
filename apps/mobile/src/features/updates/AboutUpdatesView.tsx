import { useCallback } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { AppButton } from '../../components/AppButton';
import { useTheme } from '../../theme';
import { APP_VERSION } from '../../services/updates/appUpdates';
import { useUpdateStore } from './updateStore';

interface AboutUpdatesViewProps {
  onBack: () => void;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function AboutUpdatesView({ onBack }: AboutUpdatesViewProps) {
  const { colors, spacing, radii } = useTheme();
  const latest = useUpdateStore((s) => s.latest);
  const softStatus = useUpdateStore((s) => s.softStatus);

  const download = useCallback(() => {
    if (latest) {
      void Linking.openURL(latest.apkUrl);
    }
  }, [latest]);

  const statusText = (() => {
    switch (softStatus) {
      case 'checking':
        return 'Checking for updates…';
      case 'available':
        return latest ? `Update available: ${latest.versionName}` : 'Update available';
      case 'up-to-date':
        return 'You are on the latest version.';
      case 'error':
        return 'Could not check for updates right now.';
      default:
        return 'Run a check to see if a newer version exists.';
    }
  })();

  return (
    <ScrollView
      style={{ backgroundColor: colors.background, flex: 1 }}
      contentContainerStyle={styles.content}
    >
      <AppText variant="headline">About &amp; updates</AppText>
      <AppText variant="small" color="textSecondary" style={{ marginTop: spacing.xs }}>
        Sinc is distributed through GitHub releases. New versions install over the previous APK, so
        your library, preferences, and downloads are kept.
      </AppText>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surfaceElevated,
            borderRadius: radii.md,
            marginTop: spacing.lg,
            padding: spacing.md,
          },
        ]}
      >
        <AppText variant="body">Installed version</AppText>
        <AppText variant="small" color="textSecondary" style={{ marginTop: spacing.xs }}>
          {APP_VERSION}
        </AppText>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surfaceElevated,
            borderRadius: radii.md,
            marginTop: spacing.md,
            padding: spacing.md,
          },
        ]}
      >
        <AppText variant="body">Updates</AppText>
        <AppText variant="small" color="textSecondary" style={{ marginTop: spacing.xs }}>
          {statusText}
        </AppText>

        {latest && softStatus === 'available' ? (
          <>
            {latest.publishedAt ? (
              <AppText variant="small" color="textMuted" style={{ marginTop: spacing.sm }}>
                Published {formatDate(latest.publishedAt)}
              </AppText>
            ) : null}
            {latest.notes ? (
              <AppText
                variant="small"
                color="textSecondary"
                style={{ marginTop: spacing.sm }}
                numberOfLines={8}
              >
                {latest.notes}
              </AppText>
            ) : null}
            <AppButton
              label={`Download ${latest.versionName}`}
              onPress={download}
              style={{ marginTop: spacing.md }}
            />
            <AppText variant="small" color="textMuted" style={{ marginTop: spacing.xs }}>
              Opens the APK download in your browser; tap the download to install once it lands.
            </AppText>
          </>
        ) : null}

        {latest && softStatus === 'up-to-date' ? (
          <AppText variant="small" color="textMuted" style={{ marginTop: spacing.sm }}>
            Latest release: {latest.versionName}
          </AppText>
        ) : null}
      </View>

      <AppButton
        variant="ghost"
        label="Check again"
        onPress={() => void useUpdateStore.getState().checkSoft()}
        disabled={softStatus === 'checking'}
        style={{ marginTop: spacing.md }}
      />
      <AppButton variant="ghost" label="Back" onPress={onBack} style={{ marginTop: spacing.md }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {},
});
