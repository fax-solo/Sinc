import { View } from 'react-native';
import {
  BottomTabBar,
  createBottomTabNavigator,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import Ionicons from '@react-native-vector-icons/ionicons';
import { v2Colors } from '../theme';
import { V2HomeScreen } from '../screens/V2HomeScreen';
import { V2SearchScreen } from '../screens/V2SearchScreen';
import { V2LibraryScreen } from '../screens/V2LibraryScreen';
import { V2MiniPlayer } from '../components/V2MiniPlayer';
import type { MainTabParamList } from '../../app/navigation/types';

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICONS: Record<keyof MainTabParamList, { focused: string; unfocused: string }> = {
  Home: { focused: 'home', unfocused: 'home-outline' },
  Search: { focused: 'search', unfocused: 'search-outline' },
  Library: { focused: 'library', unfocused: 'library-outline' },
};

/** Tab bar with the mini-player docked directly above it. The mini player
 *  owns the top hairline; the tab bar stays borderless so they read as one
 *  docked surface instead of two stacked boxes. */
function V2TabBar(props: BottomTabBarProps) {
  return (
    <View style={{ backgroundColor: v2Colors.surface }}>
      <V2MiniPlayer />
      <BottomTabBar {...props} />
    </View>
  );
}

export function V2Tabs() {
  return (
    <View style={{ flex: 1, backgroundColor: v2Colors.background }}>
      <View style={{ flex: 1 }}>
        <Tab.Navigator
          tabBar={(props) => <V2TabBar {...props} />}
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: v2Colors.accent,
            tabBarInactiveTintColor: v2Colors.textSecondary,
            tabBarStyle: {
              backgroundColor: v2Colors.surface,
              borderTopWidth: 0,
              height: 60,
              paddingBottom: 8,
              paddingTop: 4,
            },
            tabBarLabelStyle: {
              fontSize: 10,
              fontWeight: '700',
              letterSpacing: 0.2,
            },
          }}
        >
          <Tab.Screen
            name="Home"
            component={V2HomeScreen}
            options={{
              tabBarIcon: ({ focused, color, size }) => (
                <Ionicons
                  name={(focused ? TAB_ICONS.Home.focused : TAB_ICONS.Home.unfocused) as never}
                  size={size}
                  color={color}
                />
              ),
            }}
          />
          <Tab.Screen
            name="Search"
            component={V2SearchScreen}
            options={{
              tabBarIcon: ({ focused, color, size }) => (
                <Ionicons
                  name={(focused ? TAB_ICONS.Search.focused : TAB_ICONS.Search.unfocused) as never}
                  size={size}
                  color={color}
                />
              ),
            }}
          />
          <Tab.Screen
            name="Library"
            component={V2LibraryScreen}
            options={{
              tabBarIcon: ({ focused, color, size }) => (
                <Ionicons
                  name={
                    (focused ? TAB_ICONS.Library.focused : TAB_ICONS.Library.unfocused) as never
                  }
                  size={size}
                  color={color}
                />
              ),
            }}
          />
        </Tab.Navigator>
      </View>
    </View>
  );
}
