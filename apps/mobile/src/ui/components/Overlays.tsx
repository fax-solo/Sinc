import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@react-native-vector-icons/ionicons';
import { create } from 'zustand';
import { colors, radii, spacing } from '../theme';
import { Text } from './Text';
import { PrimaryButton } from './Buttons';
import { useLockStore } from '../../features/lock/lockStore';

export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  scroll = false,
  maxHeightRatio = 0.82,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  scroll?: boolean;
  maxHeightRatio?: number;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // Native modals sit above the RN lock overlay. Never let a sheet expose
  // library content while the app lock is armed.
  const locked = useLockStore((state) => state.enabled && !state.unlocked);

  return (
    <Modal
      visible={visible && !locked}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.overlay }}
        />
        <View
          style={{
            maxHeight: height * maxHeightRatio,
            backgroundColor: colors.backgroundRaised,
            borderTopLeftRadius: radii.xxl,
            borderTopRightRadius: radii.xxl,
            paddingTop: spacing.sm,
            paddingBottom: insets.bottom + spacing.md,
            borderTopWidth: 1,
            borderColor: colors.borderSoft,
          }}
        >
          <View
            style={{
              width: 38,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.border,
              alignSelf: 'center',
              marginBottom: spacing.md,
            }}
          />
          {title ? (
            <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.md }}>
              <Text variant="headline" numberOfLines={2}>
                {title}
              </Text>
              {subtitle ? (
                <Text variant="small" numberOfLines={2} style={{ marginTop: 3 }}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          ) : null}
          {scroll ? (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: spacing.xs }}
            >
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </View>
      </View>
    </Modal>
  );
}

export function SheetRow({
  icon,
  label,
  detail,
  onPress,
  tone = 'default',
  disabled,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail?: string;
  onPress: () => void;
  tone?: 'default' | 'danger' | 'accent';
  disabled?: boolean;
}) {
  const color =
    tone === 'danger' ? colors.error : tone === 'accent' ? colors.accent : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        opacity: disabled ? 0.35 : pressed ? 0.62 : 1,
      })}
    >
      <Ionicons name={icon} size={21} color={color} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyLarge" style={{ color }}>
          {label}
        </Text>
        {detail ? (
          <Text variant="caption" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const locked = useLockStore((state) => state.enabled && !state.unlocked);

  return (
    <Modal
      visible={visible && !locked}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.xl,
          backgroundColor: colors.overlay,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 380,
            borderRadius: radii.xl,
            backgroundColor: colors.card,
            padding: spacing.xl,
            gap: spacing.md,
            borderWidth: 1,
            borderColor: colors.borderSoft,
          }}
        >
          <Text variant="headline">{title}</Text>
          {message ? (
            <Text variant="body" color="textSecondary" style={{ lineHeight: 21 }}>
              {message}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xs }}>
            <PrimaryButton label={cancelLabel} onPress={onCancel} variant="ghost" compact />
            <PrimaryButton
              label={confirmLabel}
              onPress={onConfirm}
              variant={destructive ? 'danger' : 'primary'}
              compact
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface ToastState {
  id: number;
  message: string | null;
  tone: 'default' | 'error' | 'success';
  show: (message: string, tone?: ToastState['tone']) => void;
  hide: () => void;
}

export const useToastStore = create<ToastState>()((set) => ({
  id: 0,
  message: null,
  tone: 'default',
  show: (message, tone = 'default') =>
    set((state) => ({ id: state.id + 1, message, tone })),
  hide: () => set((state) => ({ ...state, message: null })),
}));

export function toast(message: string, tone: ToastState['tone'] = 'default'): void {
  useToastStore.getState().show(message, tone);
}

export function ToastHost() {
  const message = useToastStore((state) => state.message);
  const tone = useToastStore((state) => state.tone);
  const id = useToastStore((state) => state.id);
  const hide = useToastStore((state) => state.hide);
  const locked = useLockStore((state) => state.enabled && !state.unlocked);
  const [opacity] = useState(() => new Animated.Value(0));
  const [translate] = useState(() => new Animated.Value(12));

  useEffect(() => {
    if (locked) hide();
  }, [locked, hide]);

  useEffect(() => {
    if (!message) return;
    opacity.setValue(0);
    translate.setValue(12);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(translate, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(translate, { toValue: 8, duration: 180, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) hide();
      });
    }, 2600);
    return () => clearTimeout(timer);
  }, [id, message, opacity, translate, hide]);

  if (locked || !message) return null;
  const background =
    tone === 'error' ? colors.error : tone === 'success' ? colors.accent : colors.card;

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: spacing.lg,
        right: spacing.lg,
        bottom: 24,
        alignItems: 'center',
        zIndex: 500,
        elevation: 500,
      }}
    >
      <Animated.View
        style={{
          opacity,
          transform: [{ translateY: translate }],
          backgroundColor: background,
          borderRadius: radii.full,
          paddingHorizontal: spacing.lg,
          paddingVertical: 11,
          maxWidth: 420,
        }}
      >
        <Text
          variant="small"
          style={{
            color: tone === 'default' ? colors.text : colors.onAccent,
            fontWeight: '700',
            textAlign: 'center',
          }}
        >
          {message}
        </Text>
      </Animated.View>
    </View>
  );
}
