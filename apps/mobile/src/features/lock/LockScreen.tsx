import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Text } from '../../ui/components/Text';
import { PrimaryButton } from '../../ui/components/Buttons';
import { colors, radii, spacing } from '../../ui/theme';
import { useLockStore } from './lockStore';
import {
  verifyBiometric,
  biometricSupported,
  biometricSecretExists,
} from '../../services/security/biometric';
import {
  MAX_ATTEMPTS,
  getFailedAttempts,
  getLockoutRemainingMs,
} from '../../services/security/pin';

/** m:ss for the lockout countdown. */
function mmss(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function LockScreen() {
  const verifyPin = useLockStore((s) => s.verifyPin);
  const unlock = useLockStore((s) => s.unlock);

  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bioAvailable, setBioAvailable] = useState<boolean | null>(null);
  // Live lockout window so the countdown is real instead of a static warning.
  const [lockMs, setLockMs] = useState(() => getLockoutRemainingMs());

  const locked = lockMs > 0;

  useEffect(() => {
    if (!locked) return;
    const tick = setInterval(() => {
      const remaining = getLockoutRemainingMs();
      setLockMs(remaining);
      // Window expired — clear the countdown message so the next try reads clean.
      if (remaining <= 0) {
        setError(null);
        clearInterval(tick);
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [locked]);

  // Offer biometric unlock only when the device supports it AND the user has
  // actually enrolled a secret; hardware support alone would be a dead button.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([biometricSupported(), biometricSecretExists()]).then(
      ([supported, secretExists]) => {
        if (!cancelled) setBioAvailable(supported && secretExists);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const attemptPin = useCallback(async () => {
    if (getLockoutRemainingMs() > 0) {
      // verifyPin refuses (and won't count) attempts during backoff — say so.
      setLockMs(getLockoutRemainingMs());
      setError(`Too many attempts. Try again in ${mmss(getLockoutRemainingMs())}.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const ok = await verifyPin(pin);
      if (!ok) {
        setPin('');
        const attempts = getFailedAttempts();
        const remaining = getLockoutRemainingMs();
        if (remaining > 0) {
          setLockMs(remaining);
          setError(`Too many attempts. Locked for ${mmss(remaining)}.`);
        } else {
          setError(
            attempts > 0
              ? `Incorrect PIN — ${attempts} of ${MAX_ATTEMPTS} before lockout.`
              : 'Incorrect PIN.'
          );
        }
      }
    } finally {
      setBusy(false);
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
      <View
        style={{
          width: 78,
          height: 78,
          borderRadius: 39,
          backgroundColor: colors.accentSoft,
          borderWidth: 1,
          borderColor: 'rgba(30, 215, 96, 0.24)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.lg,
        }}
      >
        <Ionicons name="musical-notes" size={38} color={colors.accent} />
      </View>
      <Text variant="display">Sinc</Text>
      <Text variant="body" color="textSecondary" style={{ marginTop: spacing.xs }}>
        Enter your PIN to continue
      </Text>

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
            backgroundColor: colors.input,
            borderRadius: radii.md,
            color: colors.text,
            borderColor: error ? colors.error : colors.border,
          },
        ]}
      />

      {error ? (
        <Text variant="body" style={{ color: colors.error, marginTop: spacing.sm }}>
          {error}
        </Text>
      ) : null}

      <PrimaryButton
        label={locked ? `Locked (${mmss(lockMs)})` : 'Unlock'}
        onPress={() => void attemptPin()}
        disabled={locked}
        loading={busy}
        style={{ alignSelf: 'stretch', marginTop: spacing.lg }}
      />

      {bioAvailable && !locked ? (
        <Pressable
          onPress={() => void attemptBiometric()}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Unlock with biometrics"
          style={{
            marginTop: spacing.md,
            width: 46,
            height: 46,
            borderRadius: 23,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: busy ? 0.5 : 1,
          }}
        >
          <Ionicons name="finger-print" size={25} color={colors.accentBright} />
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
