import React from 'react';
import { View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { VehiclesScreen } from '../screens/vehicles/VehiclesScreen';
import { VehicleDetailScreen } from '../screens/vehicles/VehicleDetailScreen';
import { VehicleFormScreen } from '../screens/vehicles/VehicleFormScreen';
import { NotificationBell } from '../components/NotificationBell';
import { CompanySwitcher } from '../components/CompanySwitcher';

export type VehiclesStackParamList = {
  VehiclesList: undefined;
  VehicleDetail: { vehicleId: string };
  VehicleForm: { vehicleId?: string } | undefined;
};

const Stack = createNativeStackNavigator<VehiclesStackParamList>();

export function VehiclesStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#4a026f' },
        headerTintColor: '#fff',
        headerBackTitle: 'Back',
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <CompanySwitcher />
            <NotificationBell />
          </View>
        ),
      }}
    >
      <Stack.Screen name="VehiclesList" component={VehiclesScreen} options={{ title: 'Vehicles' }} />
      <Stack.Screen name="VehicleDetail" component={VehicleDetailScreen} options={{ title: 'Vehicle' }} />
      <Stack.Screen name="VehicleForm" component={VehicleFormScreen} options={{ title: 'Vehicle' }} />
    </Stack.Navigator>
  );
}
