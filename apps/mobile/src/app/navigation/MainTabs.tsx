import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useTheme } from '../../theme';
import { HomeScreen } from '../../features/home/HomeScreen';
import { SearchScreen } from '../../features/search/SearchScreen';
import { LibraryScreen } from '../../features/library/LibraryScreen';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICONS: Record<keyof MainTabParamList, { focused: string; unfocused: string }> = {
  Home: { focused: 'home', unfocused: 'home-outline' },
  Search: { focused: 'search', unfocused: 'search-outline' },
  Library: { focused: 'library', unfocused: 'library-outline' },
};

export function MainTabs() {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      {Object.entries(TAB_ICONS).map(([name, icons]) => (
        <Tab.Screen
          key={name}
          name={name as keyof MainTabParamList}
          component={
            name === 'Home' ? HomeScreen : name === 'Search' ? SearchScreen : LibraryScreen
          }
          options={{
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={(focused ? icons.focused : icons.unfocused) as never}
                size={size}
                color={color}
              />
            ),
          }}
        />
      ))}
    </Tab.Navigator>
  );
}
