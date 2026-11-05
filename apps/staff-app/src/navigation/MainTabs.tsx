import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { chatService, useAuthContext } from '@sitesync/shared';
import { DashboardStack } from './DashboardStack';
import { VehicleStack } from './VehicleStack';
import { ChatStack } from './ChatStack';
import { SettingsStack } from './SettingsStack';

const Tab = createBottomTabNavigator();

const tabIcon = (name: keyof typeof Ionicons.glyphMap) => {
  const Icon = ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} size={size} color={color} />
  );
  Icon.displayName = 'TabIcon';
  return Icon;
};

export function MainTabs() {
  const { user } = useAuthContext();
  const uid = user?.id;
  const { data: unread = 0 } = useQuery({
    queryKey: ['chat', 'unread-count', uid],
    queryFn: () => chatService.getUnreadCount(),
    enabled: Boolean(uid),
  });

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#4a026f',
        tabBarInactiveTintColor: '#897c98',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Home"
        component={DashboardStack}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: tabIcon('home-outline'),
        }}
      />
      <Tab.Screen
        name="Vehicle"
        component={VehicleStack}
        options={{
          tabBarLabel: 'Vehicle',
          tabBarIcon: tabIcon('car-outline'),
        }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatStack}
        options={{
          tabBarLabel: 'Chat',
          tabBarIcon: tabIcon('chatbubbles-outline'),
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsStack}
        options={{
          headerShown: false,
          tabBarLabel: 'Settings',
          tabBarIcon: tabIcon('settings-outline'),
        }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.navigate('Settings', { screen: 'Settings' });
          },
        })}
      />
    </Tab.Navigator>
  );
}
