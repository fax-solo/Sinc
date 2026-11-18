import type { ComponentProps } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { toast } from '../components/Overlays';
import { colors, radii, spacing } from '../theme';
import { APP_VERSION } from '../../services/updates/appUpdates';
import { useUpdateStore } from '../../features/updates/updateStore';

export function AboutScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const softStatus = useUpdateStore((state) => state.softStatus);
  const checkSoft = useUpdateStore((state) => state.checkSoft);
  const checking = softStatus === 'checking';

  const openLink = (url: string) => {
    void Linking.openURL(url).catch(() => toast('Could not open link', 'error'));
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
          About
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
        {/* App Hero */}
        <View style={{ alignItems: 'center', marginVertical: spacing.xl }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: radii.xl,
              backgroundColor: 'rgba(30, 215, 96, 0.16)',
              borderWidth: 2,
              borderColor: 'rgba(30, 215, 96, 0.35)',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: spacing.md,
              shadowColor: colors.accent,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 12,
              elevation: 8,
            }}
          >
            <Ionicons name="musical-notes" size={40} color={colors.accent} />
          </View>

          <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>
            Sinc Music
          </Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
            Version {APP_VERSION}
          </Text>
          <Text style={{ fontSize: 14, color: colors.textSecondary, marginTop: 8 }}>
            Listen. Discover. Enjoy.
          </Text>
        </View>

        {/* Menu Options */}
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: colors.borderSoft,
            overflow: 'hidden',
            marginBottom: spacing.xl,
          }}
        >
          <AboutRow
            icon="document-text-outline"
            title="Terms of Service"
            onPress={() => openLink('https://github.com/fax-solo/Sinc/blob/main/README.md')}
          />
          <AboutRow
            icon="shield-outline"
            title="Privacy Policy"
            onPress={() => openLink('https://github.com/fax-solo/Sinc/blob/main/README.md')}
          />
          <AboutRow
            icon="code-slash-outline"
            title="Open Source Licenses"
            onPress={() => openLink('https://github.com/fax-solo/Sinc')}
          />
          <AboutRow
            icon="chatbubble-outline"
            title="Contact Support"
            onPress={() => openLink('https://github.com/fax-solo/Sinc/issues')}
          />
          <AboutRow
            icon="star-outline"
            title="Check for Updates"
            detail={checking ? 'Checking…' : softStatus === 'available' ? 'Update available!' : 'Up to date'}
            onPress={() => void checkSoft()}
          />
        </View>

        {/* Made with love footer */}
        <View style={{ alignItems: 'center', marginTop: spacing.md }}>
          <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center' }}>
            Made with ❤️ for music lovers
          </Text>
          <Ionicons
            name="musical-note"
            size={16}
            color={colors.accent}
            style={{ marginTop: spacing.xs }}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function AboutRow({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  detail?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderSoft,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={colors.textSecondary} style={{ marginRight: spacing.md }} />
      <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.text }}>
        {title}
      </Text>
      {detail ? (
        <Text style={{ fontSize: 13, color: colors.accent, marginRight: spacing.xs }}>
          {detail}
        </Text>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}
