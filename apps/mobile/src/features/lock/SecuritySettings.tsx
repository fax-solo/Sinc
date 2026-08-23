import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { AppButton } from '../../components/AppButton';
import { useTheme } from '../../theme';
import { useLockStore } from './lockStore';
import {
  biometricSupported,
  saveBiometricSecret,
  clearBiometricSecret,
} from '../../services/security/biometric';
import {
  loadAnalyticsPreference,
  setAnalyticsPreference,
} from '../../services/analytics/analytics';

interface SecuritySettingsProps {
  onBack: () => void;
}

export function SecuritySettings({ onBack }: SecuritySettingsProps) {
  const { colors, spacing, radii } = useTheme();
  const enabled = useLockStore((s) => s.enabled);
  const setPin = useLockStore((s) => s.setPin);
  const disable = useLockStore((s) => s.disable);

  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void biometricSupported().then((ok) => {
      if (!cancelled) setBioAvailable(ok);
    });
    void loadAnalyticsPreference().then((enabled) => {
      if (!cancelled) setAnalyticsOn(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleBiometric = useCallback(async (next: boolean) => {
    if (next) {
      const saved = await saveBiometricSecret();
      setBioEnabled(saved);
    } else {
      await clearBiometricSecret();
      setBioEnabled(false);
    }
  }, []);

  const save = useCallback(() => {
    setError(null);
    setMessage(null);
    if (pin !== confirm) {
      setError('PINs do not match.');
      return;
    }
    if (setPin(pin)) {
      setPinValue('');
      setConfirm('');
      setMessage('App lock enabled.');
    } else {
      setError('PIN must be 4–6 digits.');
    }
  }, [pin, confirm, setPin]);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background, flex: 1 }}
      contentContainerStyle={styles.content}
    >
      <AppText variant="headline">Security</AppText>
      <AppText variant="small" color="textSecondary" style={{ marginTop: spacing.xs }}>
        Lock Sinc behind a PIN so your library and downloads stay private when the phone is handed
        around. The lock re-engages whenever the app goes to the background.
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
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <AppText variant="body">App lock</AppText>
            <AppText variant="small" color="textSecondary">
              {enabled ? 'PIN lock is on' : 'Off'}
            </AppText>
          </View>
          <Switch
            value={enabled}
            onValueChange={(value) => {
              setError(null);
              setMessage(null);
              if (!value) {
                disable();
                setMessage('App lock disabled.');
              }
            }}
            trackColor={{ true: colors.accent, false: colors.surfaceElevated }}
            thumbColor="#FFFFFF"
            accessibilityLabel="Toggle app lock"
          />
        </View>

        {enabled ? (
          <AppButton
            variant="danger"
            label="Disable lock"
            onPress={() => {
              disable();
              setMessage('App lock disabled.');
            }}
            style={{ marginTop: spacing.md }}
          />
        ) : null}

        {!enabled ? (
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            <TextInput
              value={pin}
              onChangeText={(text) => setPinValue(text.replace(/\D/g, ''))}
              placeholder="New PIN (4–6 digits)"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              style={[
                styles.input,
                {
                  backgroundColor: colors.surface,
                  borderRadius: radii.md,
                  color: colors.textPrimary,
                },
              ]}
              accessibilityLabel="New PIN"
            />
            <TextInput
              value={confirm}
              onChangeText={(text) => setConfirm(text.replace(/\D/g, ''))}
              placeholder="Confirm PIN"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              style={[
                styles.input,
                {
                  backgroundColor: colors.surface,
                  borderRadius: radii.md,
                  color: colors.textPrimary,
                },
              ]}
              accessibilityLabel="Confirm PIN"
            />
            <AppButton label="Enable lock" onPress={save} />
          </View>
        ) : null}

        {bioAvailable ? (
          <View style={[styles.row, { marginTop: spacing.md }]}>
            <View style={{ flex: 1 }}>
              <AppText variant="body">Biometric unlock</AppText>
              <AppText variant="small" color="textSecondary">
                Fingerprint / face via the OS keystore
              </AppText>
            </View>
            <Switch
              value={bioEnabled}
              onValueChange={(value) => void toggleBiometric(value)}
              trackColor={{ true: colors.accent, false: colors.surfaceElevated }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Toggle biometric unlock"
            />
          </View>
        ) : null}

        {error ? (
          <AppText variant="body" color="error" style={{ marginTop: spacing.sm }}>
            {error}
          </AppText>
        ) : null}
        {message ? (
          <AppText variant="body" color="success" style={{ marginTop: spacing.sm }}>
            {message}
          </AppText>
        ) : null}
      </View>

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
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <AppText variant="body">Anonymous usage stats</AppText>
            <AppText variant="small" color="textSecondary">
              Help improve Sinc with opt-in, privacy-clean statistics. No search text or personal
              data is ever sent.
            </AppText>
          </View>
          <Switch
            value={analyticsOn}
            onValueChange={(value) => {
              setAnalyticsOn(value);
              void setAnalyticsPreference(value);
            }}
            trackColor={{ true: colors.accent, false: colors.surfaceElevated }}
            thumbColor="#FFFFFF"
            accessibilityLabel="Toggle anonymous usage stats"
          />
        </View>
      </View>

      <AppButton variant="ghost" label="Back" onPress={onBack} style={{ marginTop: spacing.lg }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
});
