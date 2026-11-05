import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import {
  hasCapability,
  useAuthContext,
  usersService,
  vehiclesService,
  VEHICLE_STATUS_LABELS,
  VEHICLE_TYPE_LABELS,
} from '@sitesync/shared';
import type { User, Vehicle, VehicleStatus } from '@sitesync/shared';
import type { VehiclesStackParamList } from '../../navigation/VehiclesStack';
import { messageFromError } from '../../lib/apiError';

type Nav = NativeStackNavigationProp<VehiclesStackParamList, 'VehiclesList'>;
type StatusFilter = 'all' | VehicleStatus | 'archived';

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'off_road', label: 'Off road' },
  { id: 'sold', label: 'Sold' },
  { id: 'archived', label: 'Archived' },
];

function warningText(vehicle: Vehicle): string | null {
  const item = vehicle.compliance.items.find(
    (entry) =>
      entry.message &&
      (entry.state === 'due_soon' ||
        (entry.state === 'overdue' && (entry.key === 'service_date' || entry.key === 'service_mileage')))
  );
  return item?.message ?? null;
}

export function VehiclesScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuthContext();
  const canEdit = hasCapability(user?.role, 'manage_vehicles');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [allocatedTo, setAllocatedTo] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: vehicles = [], isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['vehicles', search, status, allocatedTo],
    queryFn: () =>
      vehiclesService.list({
        q: search.trim() || undefined,
        status: status === 'all' || status === 'archived' ? undefined : status,
        archived: status === 'archived',
        allocated_to: allocatedTo || undefined,
      }),
  });
  const { data: people = [] } = useQuery({
    queryKey: ['users', 'vehicle-filter'],
    queryFn: () => usersService.getAll({ active_only: true }),
  });
  const staff = useMemo(
    () => people.filter((person) => person.role === 'staff' || person.role === 'supervisor'),
    [people]
  );
  const allocatedName = staff.find((person) => person.id === allocatedTo);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#4a026f" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.empty}>{messageFromError(error, 'Could not load vehicles')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search reg, make, model"
          placeholderTextColor="#8c8c8c"
          autoCapitalize="characters"
        />
        {canEdit ? (
          <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('VehicleForm')}>
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.filters}>
        {FILTERS.map((filter) => (
          <TouchableOpacity
            key={filter.id}
            style={[styles.chip, status === filter.id && styles.chipOn]}
            onPress={() => setStatus(filter.id)}
          >
            <Text style={[styles.chipText, status === filter.id && styles.chipTextOn]}>{filter.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.chip, allocatedTo && styles.chipOn]} onPress={() => setPickerOpen(true)}>
          <Text style={[styles.chipText, allocatedTo && styles.chipTextOn]}>
            {allocatedName ? `${allocatedName.first_name} ${allocatedName.last_name}` : 'Allocated to'}
          </Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={vehicles}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={<Text style={styles.empty}>No vehicles match.</Text>}
        renderItem={({ item }) => {
          const blocked = item.block_reasons[0]?.message;
          const warning = warningText(item);
          return (
            <TouchableOpacity
              style={[styles.card, blocked ? styles.cardBlocked : warning ? styles.cardWarning : null]}
              onPress={() => navigation.navigate('VehicleDetail', { vehicleId: item.id })}
            >
              <View style={styles.cardTop}>
                <Text style={styles.reg}>{item.registration_display}</Text>
                <Text style={styles.status}>{item.archived_at ? 'Archived' : VEHICLE_STATUS_LABELS[item.status]}</Text>
              </View>
              <Text style={styles.meta}>
                {item.make} {item.model} · {VEHICLE_TYPE_LABELS[item.type]}
              </Text>
              <Text style={styles.meta}>
                {item.current_allocation?.user_name ? `Allocated to ${item.current_allocation.user_name}` : 'Not allocated'}
                {item.project_name ? ` · ${item.project_name}` : ''}
              </Text>
              {blocked ? <Text style={styles.blocked}>{blocked}</Text> : null}
              {!blocked && warning ? <Text style={styles.warning}>{warning}</Text> : null}
            </TouchableOpacity>
          );
        }}
      />
      <PersonPicker
        visible={pickerOpen}
        people={staff}
        onClose={() => setPickerOpen(false)}
        onSelect={(id) => {
          setAllocatedTo(id);
          setPickerOpen(false);
        }}
      />
    </View>
  );
}

function PersonPicker({
  visible,
  people,
  onClose,
  onSelect,
}: {
  visible: boolean;
  people: User[];
  onClose: () => void;
  onSelect: (id: string | null) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Allocated to</Text>
          <TouchableOpacity style={styles.personRow} onPress={() => onSelect(null)}>
            <Text style={styles.personName}>Anyone</Text>
          </TouchableOpacity>
          <FlatList
            data={people}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.personRow} onPress={() => onSelect(item.id)}>
                <Text style={styles.personName}>
                  {item.first_name} {item.last_name}
                </Text>
                <Text style={styles.personRole}>{item.role}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  toolbar: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  search: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#222',
  },
  addBtn: { backgroundColor: '#4a026f', borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  addBtnText: { color: '#fff', fontWeight: '700' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: '#c6b4d3', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#4a026f', borderColor: '#4a026f' },
  chipText: { color: '#5e4f6c', fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e8e8e8' },
  cardBlocked: { borderColor: '#c62828', backgroundColor: '#fff6f6' },
  cardWarning: { borderColor: '#ef6c00', backgroundColor: '#fff8f1' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reg: { fontSize: 18, fontWeight: '800', color: '#4a026f' },
  status: { fontSize: 12, fontWeight: '700', color: '#5e4f6c' },
  meta: { color: '#5c5563', marginTop: 4 },
  blocked: { color: '#c62828', fontWeight: '700', marginTop: 8 },
  warning: { color: '#ef6c00', fontWeight: '700', marginTop: 8 },
  empty: { textAlign: 'center', color: '#707173', marginTop: 40 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, maxHeight: '70%', padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#4a026f', marginBottom: 8 },
  personRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  personName: { fontSize: 16, color: '#222' },
  personRole: { color: '#707173', fontSize: 12, textTransform: 'capitalize' },
});
