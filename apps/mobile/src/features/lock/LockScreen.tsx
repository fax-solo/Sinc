import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { AppText } from '../../components/AppText';
import { AppButton } from '../../components/AppButton';
import { useTheme } from '../../theme';
import { useLockStore } from './lockStore';
import { verifyBiometric, biometricSupported } from '../../services/security/biometric';

export function LockScreen() {
  const { colors, spacing, radii } = useTheme();
  const verifyPin = useLockStore((s) => s.verifyPin);
  const unlock = useLockStore((s) => s.unlock);

  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bioAvailable, setBioAvailable] = useState<boolean | null>(null);

  // Probe for biometric availability once, lazily.
  useEffect(() => {
    let cancelled = false;
    void biometricSupported().then((ok) => {
      if (!cancelled) setBioAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const attemptPin = useCallback(() => {
    setError(null);
    if (!verifyPin(pin)) {
      setError('Incorrect PIN. Try again.');
      setPin('');
      return;
    }
  }, [pin, verifyPin]);

  const attemptBiometric = useCallback(async () => {
    setBusy(true);
    setError(null);
    const ok = await verifyBiometric();
    if (ok) unlock();
    else setError('Biometric unlock failed. Use your PIN.');
    setBusy(false);
  }, [unlock]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.icon}>
        <Ionicons name="musical-notes" size={44} color={colors.accent} />
      </View>
      <AppText variant="display">Sinc</AppText>
      <AppText variant="body" color="textSecondary" style={{ marginTop: spacing.xs }}>
        Enter your PIN to continue
      </AppText>

      <TextInput
        value={pin}
        onChangeText={(text) => {
          setPin(text.replace(/\D/g, ''));
          setError(null);
        }}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        autoFocus
        accessibilityLabel="PIN"
        placeholder="••••"
        placeholderTextColor={colors.textMuted}
        style={[
          styles.pinInput,
          {
            backgroundColor: colors.surfaceElevated,
            borderRadius: radii.md,
            color: colors.textPrimary,
            borderColor: error ? colors.error : 'transparent',
          },
        ]}
      />

      {error ? (
        <AppText variant="body" color="error" style={{ marginTop: spacing.sm }}>
          {error}
        </AppText>
      ) : null}

      <AppButton label="Unlock" onPress={attemptPin} style={{ marginTop: spacing.lg }} />

      {bioAvailable ? (
        <Pressable
          onPress={() => void attemptBiometric()}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Unlock with biometrics"
          style={{ marginTop: spacing.md }}
        >
          <Ionicons name="finger-print" size={28} color={colors.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  icon: {
    marginBottom: 16,
  },
  pinInput: {
    alignSelf: 'stretch',
    marginTop: 24,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 22,
    textAlign: 'center',
    letterSpacing: 10,
    borderWidth: 1,
  },
});
