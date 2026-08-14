import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import ProfileScreen from '../screens/ProfileScreen';
import AccountScreen from '../screens/AccountScreen';
import PlaybackSettingsScreen from '../screens/settings/PlaybackSettingsScreen';
import DownloadSettingsScreen from '../screens/settings/DownloadSettingsScreen';
import LyricsSettingsScreen from '../screens/settings/LyricsSettingsScreen';
import NotificationsSettingsScreen from '../screens/settings/NotificationsSettingsScreen';
import StorageScreen from '../screens/settings/StorageScreen';
import PrivacySettingsScreen from '../screens/settings/PrivacySettingsScreen';
import SecurityScreen from '../screens/settings/SecurityScreen';
import AboutScreen from '../screens/settings/AboutScreen';
import type { ProfileTabParamList } from './types';

const Stack = createNativeStackNavigator<ProfileTabParamList>();

export default function ProfileStack(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileScreen" component={ProfileScreen} />
      <Stack.Screen
        name="Account"
        component={AccountScreen}
        options={{ title: t('profile.account') }}
      />
      <Stack.Screen
        name="PlaybackSettings"
        component={PlaybackSettingsScreen}
        options={{ title: t('profile.playback') }}
      />
      <Stack.Screen
        name="DownloadSettings"
        component={DownloadSettingsScreen}
        options={{ title: t('downloads.settings') }}
      />
      <Stack.Screen
        name="LyricsSettings"
        component={LyricsSettingsScreen}
        options={{ title: t('profile.lyrics') }}
      />
      <Stack.Screen
        name="Notifications"
        component={NotificationsSettingsScreen}
        options={{ title: t('profile.notifications') }}
      />
      <Stack.Screen
        name="Storage"
        component={StorageScreen}
        options={{ title: t('profile.storage') }}
      />
      <Stack.Screen
        name="Privacy"
        component={PrivacySettingsScreen}
        options={{ title: t('profile.privacy') }}
      />
      <Stack.Screen
        name="Security"
        component={SecurityScreen}
        options={{ title: t('profile.security') }}
      />
      <Stack.Screen name="About" component={AboutScreen} options={{ title: t('profile.about') }} />
    </Stack.Navigator>
  );
}
