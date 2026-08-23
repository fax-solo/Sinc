import { Linking, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { AppButton } from '../../components/AppButton';
import { useTheme } from '../../theme';
import { APP_VERSION } from '../../services/updates/appUpdates';

export function UpdateRequiredScreen({ minAppVersion }: { minAppVersion: string }) {
  const { colors, spacing, radii } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background, padding: spacing.lg }]}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surfaceElevated, borderRadius: radii.md, padding: spacing.lg },
        ]}
      >
        <AppText variant="headline">Update required</AppText>
        <AppText variant="body" color="textSecondary" style={{ marginTop: spacing.sm }}>
          This version of Sinc is out of date. Please update to version {minAppVersion} or later to
          keep listening.
        </AppText>
        <AppText variant="small" color="textMuted" style={{ marginTop: spacing.xs }}>
          Installed: {APP_VERSION}
        </AppText>
        <AppButton
          label="Open the store"
          onPress={() =>
            void Linking.openURL('https://play.google.com/store/apps/details?id=com.sinc.app')
          }
          style={{ marginTop: spacing.lg }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 420,
  },
});
