import { View } from 'react-native';
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import { BottomDock } from '../../ui/components/BottomDock';
import { HomeScreen } from '../../ui/screens/HomeScreen';
import { SearchScreen } from '../../ui/screens/SearchScreen';
import { LibraryScreen } from '../../ui/screens/LibraryScreen';
import type { MainTabName, MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

function NewTabBar({ state, navigation }: BottomTabBarProps) {
  const current = state.routes[state.index]?.name as MainTabName | undefined;
  return (
    <BottomDock
      activeTab={current ?? 'Home'}
      onTabPress={(tab) => {
        const route = state.routes.find((item) => item.name === tab);
        if (!route) return;
        const event = navigation.emit({
          type: 'tabPress',
          target: route.key,
          canPreventDefault: true,
        });
        if (event.defaultPrevented) return;
        navigation.navigate(tab, route.params as never);
      }}
    />
  );
}

/** Persistent bottom tabs. The custom dock owns the mini player + safe area. */
export function MainTabs() {
  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        initialRouteName="Home"
        tabBar={(props) => <NewTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          sceneStyle: { backgroundColor: '#0B0F0E' },
        }}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Search" component={SearchScreen} />
        <Tab.Screen name="Library" component={LibraryScreen} />
      </Tab.Navigator>
    </View>
  );
}
