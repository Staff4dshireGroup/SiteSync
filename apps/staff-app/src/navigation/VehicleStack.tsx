import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MyVehicleScreen } from '../screens/vehicle/MyVehicleScreen';
import { NotificationBell } from '../components/NotificationBell';

export type VehicleStackParamList = {
  MyVehicle: undefined;
};

const Stack = createNativeStackNavigator<VehicleStackParamList>();

export function VehicleStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#4a026f' },
        headerTintColor: '#fff',
        headerBackTitle: 'Back',
        headerRight: () => <NotificationBell />,
      }}
    >
      <Stack.Screen name="MyVehicle" component={MyVehicleScreen} options={{ title: 'Vehicle' }} />
    </Stack.Navigator>
  );
}
