import { Pressable, View } from 'react-native';
import type { ComponentProps } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@react-native-vector-icons/ionicons';
import { colors, spacing, tabBarHeight } from '../theme';
import { Text } from './Text';
import { MiniPlayer } from './Playback';
import type { MainTabName } from '../../app/navigation/types';

const TABS: Array<{
  key: MainTabName;
  label: string;
  active: ComponentProps<typeof Ionicons>['name'];
  inactive: ComponentProps<typeof Ionicons>['name'];
}> = [
  { key: 'Home', label: 'Home', active: 'home', inactive: 'home-outline' },
  { key: 'Search', label: 'Search', active: 'search', inactive: 'search-outline' },
  { key: 'Library', label: 'Your Library', active: 'library', inactive: 'library-outline' },
];

export function BottomDock({
  activeTab,
  onTabPress,
}: {
  activeTab: MainTabName;
  onTabPress: (tab: MainTabName) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        backgroundColor: colors.background,
        borderTopWidth: 1,
        borderTopColor: colors.borderSoft,
      }}
    >
      <MiniPlayer />
      <View
        accessibilityRole="tablist"
        style={{
          height: tabBarHeight + insets.bottom,
          paddingBottom: insets.bottom,
          flexDirection: 'row',
          alignItems: 'stretch',
          paddingHorizontal: spacing.sm,
        }}
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onTabPress(tab.key)}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                opacity: pressed ? 0.66 : 1,
              })}
            >
              <Ionicons
                name={active ? tab.active : tab.inactive}
                size={23}
                color={active ? colors.accent : colors.textMuted}
              />
              <Text
                variant="caption"
                style={{
                  color: active ? colors.accent : colors.textMuted,
                  fontWeight: active ? '700' : '500',
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
