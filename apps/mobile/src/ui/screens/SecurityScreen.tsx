import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Text } from '../components/Text';
import { IconButton, PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Fields';
import { ConfirmDialog, toast } from '../components/Overlays';
import { colors, radii, spacing } from '../theme';
import { useLockStore } from '../../features/lock/lockStore';
import {
  biometricSupported,
  biometricSecretExists,
  saveBiometricSecret,
  clearBiometricSecret,
} from '../../services/security/biometric';
import {
  loadAnalyticsPreference,
  setAnalyticsPreference,
} from '../../services/analytics/analytics';
import { usePersonalizationStore } from '../../services/local/personalizationStore';
import { useLibraryStore } from '../../services/library/libraryStore';
import type { RootStackParamList } from '../../app/navigation/types';

export function SecurityScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const enabled = useLockStore((state) => state.enabled);
  const setPin = useLockStore((state) => state.setPin);
  const disable = useLockStore((state) => state.disable);

  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [changingPin, setChangingPin] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(false);

  // Personalization settings
  const personalizationEnabled = usePersonalizationStore((state) => state.enabled);
  const setPersonalizationEnabled = usePersonalizationStore((state) => state.setEnabled);
  const discoveryMode = usePersonalizationStore((state) => state.discoveryMode);
  const setDiscoveryMode = usePersonalizationStore((state) => state.setDiscoveryMode);
  const resetTasteProfile = usePersonalizationStore((state) => state.resetTasteProfile);
  const clearRecommendationFeedback = useLibraryStore((state) => state.clearRecommendationFeedback);
  const clearHistory = useLibraryStore((state) => state.clearHistory);

  const [resetTasteOpen, setResetTasteOpen] = useState(false);
  const [clearFeedbackOpen, setClearFeedbackOpen] = useState(false);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([biometricSupported(), biometricSecretExists()]).then(
      ([supported, secretExists]) => {
        if (cancelled) return;
        setBioAvailable(supported);
        setBioEnabled(supported && secretExists);
      }
    );
    void loadAnalyticsPreference().then((value) => {
      if (!cancelled) setAnalyticsOn(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetFields = useCallback(() => {
    setPinValue('');
    setConfirm('');
    setError(null);
  }, []);

  const savePin = async () => {
    setError(null);
    if (pin.length < 4 || pin.length > 6) {
      setError('Use a 4–6 digit PIN.');
      return;
    }
    if (pin !== confirm) {
      setError('The PINs do not match.');
      return;
    }
    const ok = await setPin(pin);
    if (ok) {
      resetFields();
      setChangingPin(false);
      toast(enabled ? 'PIN updated' : 'App lock enabled', 'success');
    } else {
      setError('The PIN could not be saved.');
    }
  };

  const toggleBiometric = async (next: boolean) => {
    if (bioBusy) return;
    setBioBusy(true);
    try {
      if (next) {
        const saved = await saveBiometricSecret();
        setBioEnabled(saved);
        if (!saved) toast('Biometric unlock could not be enabled on this device', 'error');
      } else {
        await clearBiometricSecret();
        setBioEnabled(false);
      }
    } finally {
      setBioBusy(false);
    }
  };

  const showPinFields = !enabled || changingPin;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.xs,
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
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
            <Text variant="headline">Privacy & security</Text>
            <Text variant="caption">Your library is local to this device</Text>
          </View>
        </View>

        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: radii.lg,
            padding: spacing.md,
            gap: spacing.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                backgroundColor: enabled ? colors.accentSoft : colors.input,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name={enabled ? 'lock-closed' : 'lock-open-outline'}
                size={20}
                color={enabled ? colors.accent : colors.textSecondary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">App lock</Text>
              <Text variant="caption">
                {enabled ? 'A PIN is required when Sinc opens.' : 'No PIN is set.'}
              </Text>
            </View>
            <Switch
              value={enabled || changingPin}
              onValueChange={(value) => {
                if (!value) {
                  setDisableOpen(true);
                } else {
                  setChangingPin(true);
                  setError(null);
                }
              }}
              trackColor={{ true: colors.accent, false: colors.input }}
              thumbColor={colors.white}
              accessibilityLabel="Toggle app lock"
            />
          </View>

          <Text variant="small" color="textSecondary">
            Sinc locks whenever the app leaves the foreground. The PIN is stored as a salted hash
            on this device, never in plain text.
          </Text>

          {enabled && !changingPin ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <PrimaryButton
                label="Change PIN"
                variant="secondary"
                compact
                style={{ flex: 1 }}
                onPress={() => {
                  resetFields();
                  setChangingPin(true);
                }}
              />
              <PrimaryButton
                label="Disable lock"
                variant="danger"
                compact
                style={{ flex: 1 }}
                onPress={() => setDisableOpen(true)}
              />
            </View>
          ) : null}

          {showPinFields ? (
            <View style={{ gap: spacing.sm }}>
              <Field
                label={enabled ? 'New PIN' : 'Create PIN'}
                value={pin}
                onChangeText={(value) => setPinValue(value.replace(/\D/g, ''))}
                placeholder="4–6 digits"
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                accessibilityLabel="New PIN"
              />
              <Field
                label="Confirm PIN"
                value={confirm}
                onChangeText={(value) => setConfirm(value.replace(/\D/g, ''))}
                placeholder="Enter it again"
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                accessibilityLabel="Confirm PIN"
                onSubmitEditing={() => void savePin()}
              />
              {error ? (
                <Text variant="small" style={{ color: colors.error }}>
                  {error}
                </Text>
              ) : null}
              <PrimaryButton
                label={enabled ? 'Save new PIN' : 'Enable app lock'}
                onPress={() => void savePin()}
                disabled={pin.length < 4 || confirm.length < 4}
              />
              {changingPin ? (
                <PrimaryButton
                  label="Cancel"
                  variant="ghost"
                  compact
                  onPress={() => {
                    resetFields();
                    setChangingPin(false);
                  }}
                />
              ) : null}
            </View>
          ) : null}
        </View>

        {bioAvailable && enabled ? (
          <View
            style={{
              marginTop: spacing.md,
              backgroundColor: colors.card,
              borderRadius: radii.lg,
              padding: spacing.md,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
            }}
          >
            <Ionicons name="finger-print-outline" size={22} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">Biometric unlock</Text>
              <Text variant="caption">
                Use the OS fingerprint or face prompt instead of typing your PIN.
              </Text>
            </View>
            <Switch
              value={bioEnabled}
              disabled={bioBusy}
              onValueChange={(value) => void toggleBiometric(value)}
              trackColor={{ true: colors.accent, false: colors.input }}
              thumbColor={colors.white}
              accessibilityLabel="Toggle biometric unlock"
            />
          </View>
        ) : null}

        {/* Personalization & Music Recommendation Settings */}
        <View
          style={{
            marginTop: spacing.md,
            backgroundColor: colors.card,
            borderRadius: radii.lg,
            padding: spacing.md,
            gap: spacing.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Ionicons name="sparkles-outline" size={22} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">Music Personalization</Text>
              <Text variant="caption">
                Local-only music intelligence. Generates custom mixes and recommendations based on your listening habits.
              </Text>
            </View>
            <Switch
              value={personalizationEnabled}
              onValueChange={(val) => {
                setPersonalizationEnabled(val);
                toast(val ? 'Personalization enabled' : 'Personalization disabled', 'default');
              }}
              trackColor={{ true: colors.accent, false: colors.input }}
              thumbColor={colors.white}
              accessibilityLabel="Toggle music personalization"
            />
          </View>

          {personalizationEnabled ? (
            <View style={{ gap: spacing.sm, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.borderSoft }}>
              <Text variant="bodyStrong">Recommendation Discovery Mode</Text>
              <Text variant="caption">
                Controls how adventurous mixes and discovery suggestions should be.
              </Text>

              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                {(
                  [
                    { mode: 'familiar', label: 'Familiar', desc: 'Focus on favorite & familiar tracks' },
                    { mode: 'balanced', label: 'Balanced', desc: 'Blend favorites with discoveries' },
                    { mode: 'exploration', label: 'Exploration', desc: 'Adventurous picks & new genres' },
                  ] as const
                ).map(({ mode, label }) => {
                  const active = discoveryMode === mode;
                  return (
                    <PrimaryButton
                      key={mode}
                      label={label}
                      variant={active ? 'primary' : 'secondary'}
                      compact
                      style={{ flex: 1 }}
                      onPress={() => {
                        setDiscoveryMode(mode);
                        toast(`Discovery mode set to ${label}`, 'default');
                      }}
                    />
                  );
                })}
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <PrimaryButton
                  label="Reset Taste Profile"
                  variant="secondary"
                  compact
                  style={{ flex: 1 }}
                  onPress={() => setResetTasteOpen(true)}
                />
                <PrimaryButton
                  label="Clear Feedback"
                  variant="secondary"
                  compact
                  style={{ flex: 1 }}
                  onPress={() => setClearFeedbackOpen(true)}
                />
              </View>
            </View>
          ) : null}
        </View>

        <View
          style={{
            marginTop: spacing.md,
            backgroundColor: colors.card,
            borderRadius: radii.lg,
            padding: spacing.md,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
          }}
        >
          <Ionicons name="bar-chart-outline" size={22} color={colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">Anonymous usage stats</Text>
            <Text variant="caption">
              Optional, privacy-clean events. Search text and personal data are never sent.
            </Text>
          </View>
          <Switch
            value={analyticsOn}
            onValueChange={(value) => {
              setAnalyticsOn(value);
              void setAnalyticsPreference(value);
            }}
            trackColor={{ true: colors.accent, false: colors.input }}
            thumbColor={colors.white}
            accessibilityLabel="Toggle anonymous usage stats"
          />
        </View>

        <Text variant="caption" style={{ marginTop: spacing.lg, lineHeight: 17 }}>
          Sinc has no account and no cloud library. All recommendation algorithms, taste profiles, and
          play statistics stay 100% on your device.
        </Text>
      </ScrollView>

      <ConfirmDialog
        visible={resetTasteOpen}
        title="Reset Music Taste Profile?"
        message="This clears your learned music preferences and listening event records. Your liked songs, playlists, and downloads will remain untouched."
        confirmLabel="Reset Profile"
        destructive
        onCancel={() => setResetTasteOpen(false)}
        onConfirm={() => {
          resetTasteProfile();
          setResetTasteOpen(false);
          toast('Music taste profile reset', 'success');
        }}
      />

      <ConfirmDialog
        visible={clearFeedbackOpen}
        title="Clear Recommendation Feedback?"
        message="This clears your thumbs-up, thumbs-down, and hidden artist/song filters."
        confirmLabel="Clear Feedback"
        destructive
        onCancel={() => setClearFeedbackOpen(false)}
        onConfirm={() => {
          clearRecommendationFeedback();
          setClearFeedbackOpen(false);
          toast('Recommendation feedback cleared', 'success');
        }}
      />

      <ConfirmDialog
        visible={disableOpen}
        title="Disable app lock?"
        message="Anyone with this phone will be able to open Sinc and see your library and downloads."
        confirmLabel="Disable"
        destructive
        onCancel={() => setDisableOpen(false)}
        onConfirm={() => {
          disable();
          setBioEnabled(false);
          setChangingPin(false);
          resetFields();
          setDisableOpen(false);
          toast('App lock disabled', 'success');
        }}
      />
    </KeyboardAvoidingView>
  );
}
