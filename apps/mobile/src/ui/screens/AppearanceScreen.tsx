import { Pressable, ScrollView, Switch, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { colors, radii, spacing } from '../theme';
import {
  ACCENT_COLORS,
  useProfileStore,
  type ThemeMode,
} from '../../features/profile/profileStore';

export function AppearanceScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const profile = useProfileStore();

  const THEMES: Array<{ mode: ThemeMode; label: string; icon: string }> = [
    { mode: 'dark', label: 'Dark', icon: 'moon-outline' },
    { mode: 'light', label: 'Light', icon: 'sunny-outline' },
    { mode: 'system', label: 'System', icon: 'contrast-outline' },
  ];

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
          Appearance
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
        {/* Section 1: Theme */}
        <View style={{ marginBottom: spacing.xl }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.md }}>
            Theme
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {THEMES.map((t) => {
              const isSelected = profile.theme === t.mode;
              return (
                <Pressable
                  key={t.mode}
                  onPress={() => profile.setTheme(t.mode)}
                  style={({ pressed }) => ({
                    flex: 1,
                    backgroundColor: colors.card,
                    borderRadius: radii.lg,
                    borderWidth: 2,
                    borderColor: isSelected ? colors.accent : colors.borderSoft,
                    paddingVertical: spacing.lg,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Ionicons
                    name={t.icon as any}
                    size={28}
                    color={isSelected ? colors.accent : colors.textSecondary}
                    style={{ marginBottom: spacing.xs }}
                  />
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: '700',
                      color: isSelected ? colors.text : colors.textMuted,
                    }}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Section 2: Accent Color */}
        <View style={{ marginBottom: spacing.xl }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.md }}>
            Accent Color
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            {ACCENT_COLORS.map((item) => {
              const isSelected = profile.accentColor === item.color;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => profile.setAccentColor(item.color)}
                  style={({ pressed }) => ({
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: item.color,
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: [{ scale: isSelected ? 1.08 : 1 }],
                    borderWidth: isSelected ? 3 : 0,
                    borderColor: colors.text,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  {isSelected ? (
                    <Ionicons name="checkmark" size={22} color="#000000" />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Section 3: UI Settings */}
        <View style={{ marginBottom: spacing.xl }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.md }}>
            UI Settings
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
            {/* Dynamic Color Toggle */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.borderSoft,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
                Dynamic Color
              </Text>
              <Switch
                value={profile.dynamicColor}
                onValueChange={(val) => profile.setDynamicColor(val)}
                trackColor={{ false: colors.input, true: colors.accent }}
                thumbColor={colors.white}
              />
            </View>

            {/* Reduce Motion Toggle */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.borderSoft,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
                Reduce Motion
              </Text>
              <Switch
                value={profile.reduceMotion}
                onValueChange={(val) => profile.setReduceMotion(val)}
                trackColor={{ false: colors.input, true: colors.accent }}
                thumbColor={colors.white}
              />
            </View>

            {/* Text Size */}
            <Pressable
              style={({ pressed }) => ({
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
                Text Size
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 14, color: colors.textMuted }}>Normal</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </View>
            </Pressable>
          </View>
        </View>

        {/* Bottom Banner Card: "A clean look, your way." */}
        <View
          style={{
            backgroundColor: '#151D1A',
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: 'rgba(30, 215, 96, 0.2)',
            padding: spacing.lg,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>
              A clean look, your way.
            </Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
              Customized dark tones and accents crafted for pure music enjoyment.
            </Text>
          </View>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: 'rgba(30, 215, 96, 0.15)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="musical-notes" size={24} color={colors.accent} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
