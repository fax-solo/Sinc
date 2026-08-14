import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import HomeStack from './HomeStack';
import SearchStack from './SearchStack';
import LibraryStack from './LibraryStack';
import DownloadsScreen from '../screens/DownloadsScreen';
import ProfileStack from './ProfileStack';
import type { MainTabsParamList } from './types';

const Tab = createBottomTabNavigator<MainTabsParamList>();

export default function MainTabs(): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens, isDark } = useTheme();

  const tabIcon =
    (label: string): (() => React.JSX.Element) =>
    () => {
      const char = label.slice(0, 1).toUpperCase();
      return (
        <React.Fragment>
          <TextPlaceholder char={char} color={tokens.colors.primary} />
        </React.Fragment>
      );
    };

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: tokens.colors.primary,
        tabBarInactiveTintColor: tokens.colors.onSurfaceVariant,
        tabBarStyle: {
          backgroundColor: isDark ? tokens.colors.surfaceContainerHigh : tokens.colors.surface,
          borderTopColor: tokens.colors.outlineVariant,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStack}
        options={{ title: t('tabs.home'), tabBarIcon: tabIcon(t('tabs.home')) }}
      />
      <Tab.Screen
        name="Search"
        component={SearchStack}
        options={{ title: t('tabs.search'), tabBarIcon: tabIcon(t('tabs.search')) }}
      />
      <Tab.Screen
        name="Library"
        component={LibraryStack}
        options={{ title: t('tabs.library'), tabBarIcon: tabIcon(t('tabs.library')) }}
      />
      <Tab.Screen
        name="Downloads"
        component={DownloadsScreen}
        options={{ title: t('tabs.downloads'), tabBarIcon: tabIcon(t('tabs.downloads')) }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        options={{ title: t('tabs.profile'), tabBarIcon: tabIcon(t('tabs.profile')) }}
      />
    </Tab.Navigator>
  );
}

function TextPlaceholder({ char, color }: { char: string; color: string }): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <Text
      style={[
        tokens.typography.caption,
        { color, textAlign: 'center', width: 28, height: 28, lineHeight: 28 },
      ]}
    >
      {char}
    </Text>
  );
}
