import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  FlatList,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  hasCapability,
  projectsService,
  useAuthContext,
  usersService,
  vehiclesService,
  VEHICLE_FUEL_LABELS,
  VEHICLE_STATUS_LABELS,
  VEHICLE_TYPE_LABELS,
} from '@sitesync/shared';
import type { ExpiryItem, Vehicle } from '@sitesync/shared';
import type { VehiclesStackParamList } from '../../navigation/VehiclesStack';
import { messageFromError } from '../../lib/apiError';

type Route = RouteProp<VehiclesStackParamList, 'VehicleDetail'>;
type Nav = NativeStackNavigationProp<VehiclesStackParamList, 'VehicleDetail'>;

function showDate(iso?: string): string {
  if (!iso) return 'Not set';
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function warningItems(vehicle: Vehicle): ExpiryItem[] {
  return vehicle.compliance.items.filter(
    (item) =>
      item.message &&
      (item.state === 'due_soon' ||
        (item.state === 'overdue' && (item.key === 'service_date' || item.key === 'service_mileage')))
  );
}

export function VehicleDetailScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const canEdit = hasCapability(user?.role, 'manage_vehicles');
  const canAssign = hasCapability(user?.role, 'allocate_vehicles');
  const vehicleId = route.params.vehicleId;
  const [userId, setUserId] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  });
  const [untilFurther, setUntilFurther] = useState(true);
  const [endDate, setEndDate] = useState('');
  const [projectId, setProjectId] = useState('');
  const [picker, setPicker] = useState<'user' | 'project' | 'link' | null>(null);
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');

  const { data: vehicle, isLoading, refetch } = useQuery({
    queryKey: ['vehicles', vehicleId],
    queryFn: () => vehiclesService.getById(vehicleId),
  });
  const { data: people = [] } = useQuery({
    queryKey: ['users', 'allocate'],
    queryFn: () => usersService.getAll({ active_only: true }),
    enabled: canAssign,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsService.getAll(),
    enabled: canAssign,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    await refetch();
  };

  const allocate = useMutation({
    mutationFn: () =>
      vehiclesService.allocate(vehicleId, {
        user_id: userId,
        start_date: startDate,
        until_further_notice: untilFurther,
        end_date: untilFurther ? null : endDate,
        ...(projectId ? { project_id: projectId } : {}),
      }),
    onSuccess: refresh,
    onError: (error: unknown) => Alert.alert('Cannot allocate', messageFromError(error, 'Allocation failed')),
  });
  const unallocate = useMutation({
    mutationFn: () => vehiclesService.unallocate(vehicleId),
    onSuccess: refresh,
    onError: (error: unknown) => Alert.alert('Cannot unallocate', messageFromError(error, 'Unallocate failed')),
  });
  const linkProject = useMutation({
    mutationFn: (nextProjectId: string | null) => vehiclesService.update(vehicleId, { project_id: nextProjectId }),
    onSuccess: refresh,
    onError: (error: unknown) => Alert.alert('Cannot link project', messageFromError(error, 'Update failed')),
  });
  const resolve = useMutation({
    mutationFn: () => vehiclesService.resolveDefect(vehicleId, resolveId!, resolution.trim()),
    onSuccess: async () => {
      setResolveId(null);
      setResolution('');
      await refresh();
    },
    onError: (error: unknown) => Alert.alert('Could not resolve defect', messageFromError(error, 'Resolve failed')),
  });

  if (isLoading || !vehicle) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#4a026f" />
      </View>
    );
  }

  const assignee = people.find((person) => person.id === userId);
  const project = projects.find((item) => item.id === projectId);
  const warnings = warningItems(vehicle);
  const staff = people.filter((person) => person.role === 'staff' || person.role === 'supervisor');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {vehicle.photo_url ? <Image source={{ uri: vehicle.photo_url }} style={styles.photo} /> : null}
      <Text style={styles.reg}>{vehicle.registration_display}</Text>
      <Text style={styles.sub}>
        {vehicle.make} {vehicle.model} · {VEHICLE_TYPE_LABELS[vehicle.type]} · {vehicle.colour} · {VEHICLE_FUEL_LABELS[vehicle.fuel_type]}
      </Text>
      <Text style={styles.meta}>
        {vehicle.archived_at ? 'Archived' : VEHICLE_STATUS_LABELS[vehicle.status]}
        {vehicle.vin ? ` · VIN ${vehicle.vin}` : ''}
        {vehicle.current_mileage != null ? ` · ${vehicle.current_mileage} miles` : ''}
      </Text>
      {canEdit ? (
        <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.navigate('VehicleForm', { vehicleId })}>
          <Text style={styles.linkText}>Edit vehicle</Text>
        </TouchableOpacity>
      ) : null}

      {vehicle.block_reasons.length > 0 ? (
        <View style={styles.blockBox}>
          <Text style={styles.blockTitle}>Cannot be sent out</Text>
          {vehicle.block_reasons.map((reason) => (
            <Text key={reason.code} style={styles.blockText}>
              {reason.message}
            </Text>
          ))}
        </View>
      ) : (
        <View style={styles.okBox}>
          <Text style={styles.okText}>Cleared for use today</Text>
        </View>
      )}
      {warnings.length > 0 ? (
        <View style={styles.warnBox}>
          {warnings.map((item) => (
            <Text key={item.key} style={styles.warnText}>
              {item.message}
            </Text>
          ))}
        </View>
      ) : null}

      <Text style={styles.section}>Due dates</Text>
      <Due label="MOT" value={showDate(vehicle.mot_due)} />
      <Due label="Road tax" value={showDate(vehicle.road_tax_due)} />
      <Due label="Insurance" value={showDate(vehicle.insurance_expiry)} />
      <Due label="Service" value={showDate(vehicle.service_due_date)} />
      <Due label="Service mileage" value={vehicle.service_due_mileage != null ? String(vehicle.service_due_mileage) : 'Not set'} />
      <Due label="Project" value={vehicle.project_name ?? 'None'} />
      {vehicle.notes ? <Text style={styles.notes}>{vehicle.notes}</Text> : null}

      <Text style={styles.section}>Current allocation</Text>
      {vehicle.current_allocation ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{vehicle.current_allocation.user_name}</Text>
          <Text style={styles.meta}>
            From {showDate(vehicle.current_allocation.start_date)}
            {vehicle.current_allocation.until_further_notice
              ? ' · until further notice'
              : ` · until ${showDate(vehicle.current_allocation.end_date)}`}
          </Text>
          <Text style={styles.meta}>Assigned by {vehicle.current_allocation.assigned_by_name ?? 'unknown'}</Text>
          {canAssign ? (
            <TouchableOpacity style={styles.secondaryBtn} disabled={unallocate.isPending} onPress={() => unallocate.mutate()}>
              <Text style={styles.secondaryText}>Unallocate</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <Text style={styles.meta}>Nobody has this vehicle.</Text>
      )}

      {canAssign ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Allocate</Text>
          {vehicle.allocate_block_reasons.map((reason) => (
            <Text key={reason.code} style={styles.blockText}>
              {reason.message}
            </Text>
          ))}
          <TouchableOpacity style={styles.input} onPress={() => setPicker('user')}>
            <Text>{assignee ? `${assignee.first_name} ${assignee.last_name}` : 'Choose staff member'}</Text>
          </TouchableOpacity>
          <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="Start YYYY-MM-DD" />
          <TouchableOpacity style={styles.checkRow} onPress={() => setUntilFurther((value) => !value)}>
            <Text style={styles.meta}>{untilFurther ? '☑' : '☐'} Until further notice</Text>
          </TouchableOpacity>
          {!untilFurther ? <TextInput style={styles.input} value={endDate} onChangeText={setEndDate} placeholder="End YYYY-MM-DD" /> : null}
          <TouchableOpacity style={styles.input} onPress={() => setPicker('project')}>
            <Text>{project?.name ?? 'Optional project'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryBtn, !vehicle.allocatable && styles.disabled]}
            disabled={!vehicle.allocatable || allocate.isPending || !userId}
            onPress={() => allocate.mutate()}
          >
            {allocate.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Allocate</Text>}
          </TouchableOpacity>
        </View>
      ) : null}

      {canEdit ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Link to a project</Text>
          <Text style={styles.meta}>A blocked vehicle cannot be linked to a project. Clearing the link is always allowed.</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setPicker('link')}>
            <Text style={styles.secondaryText}>{vehicle.project_name ? `Change (${vehicle.project_name})` : 'Choose project'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Text style={styles.section}>Allocation history</Text>
      {(vehicle.allocations ?? []).map((allocation) => (
        <View key={allocation.id} style={styles.historyRow}>
          <Text style={styles.cardTitle}>
            {allocation.user_name} {allocation.active ? '· current' : ''}
          </Text>
          <Text style={styles.meta}>
            {showDate(allocation.start_date)} – {allocation.until_further_notice ? 'until further notice' : showDate(allocation.end_date)}
          </Text>
          <Text style={styles.meta}>
            Assigned {new Date(allocation.assigned_at).toLocaleString('en-GB')} by {allocation.assigned_by_name ?? 'unknown'}
            {allocation.ended_at ? ` · ended ${new Date(allocation.ended_at).toLocaleString('en-GB')}` : ''}
          </Text>
        </View>
      ))}
      {(vehicle.allocations ?? []).length === 0 ? <Text style={styles.meta}>No allocations yet.</Text> : null}

      <Text style={styles.section}>Checks and defects</Text>
      {(vehicle.open_defects ?? []).map((defect) => (
        <View key={defect.id} style={styles.blockBox}>
          <Text style={styles.blockTitle}>Unsafe / off road</Text>
          <Text style={styles.blockText}>{defect.notes}</Text>
          {canEdit ? (
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setResolveId(defect.id)}>
              <Text style={styles.secondaryText}>Resolve</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
      {(vehicle.checks ?? []).map((check) => (
        <View key={check.id} style={styles.historyRow}>
          <Text style={styles.cardTitle}>
            {check.checked_on} · {check.result === 'pass' ? 'Passed' : 'Failed'}
            {check.unsafe ? ' · unsafe' : ''}
          </Text>
          <Text style={styles.meta}>
            {check.mileage} miles · {check.user_name}
            {check.notes ? ` · ${check.notes}` : ''}
          </Text>
        </View>
      ))}
      {(vehicle.checks ?? []).length === 0 ? <Text style={styles.meta}>No start-of-day checks yet.</Text> : null}
      {(vehicle.defects ?? [])
        .filter((defect) => defect.status === 'resolved')
        .map((defect) => (
          <View key={defect.id} style={styles.historyRow}>
            <Text style={styles.cardTitle}>Resolved defect</Text>
            <Text style={styles.meta}>{defect.notes}</Text>
            <Text style={styles.meta}>
              {defect.resolution_notes} · {defect.resolved_by_name}
            </Text>
          </View>
        ))}

      <PickerModal
        visible={picker != null}
        title={picker === 'user' ? 'Staff member' : 'Project'}
        rows={
          picker === 'user'
            ? staff.map((person) => ({ id: person.id, label: `${person.first_name} ${person.last_name}` }))
            : [{ id: '', label: 'No project' }, ...projects.filter((item) => !item.archived).map((item) => ({ id: item.id, label: item.name }))]
        }
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          if (picker === 'user') setUserId(id);
          else if (picker === 'link') linkProject.mutate(id || null);
          else setProjectId(id);
          setPicker(null);
        }}
      />
      <Modal visible={resolveId != null} transparent animationType="fade" onRequestClose={() => setResolveId(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>Resolve defect</Text>
            <Text style={styles.meta}>Notes are required. Resolving clears the off-road block.</Text>
            <TextInput style={[styles.input, styles.notesInput]} value={resolution} onChangeText={setResolution} multiline placeholder="What was done" />
            <TouchableOpacity style={styles.primaryBtn} disabled={!resolution.trim() || resolve.isPending} onPress={() => resolve.mutate()}>
              <Text style={styles.primaryText}>Resolve</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setResolveId(null)}>
              <Text style={styles.linkText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function Due({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dueRow}>
      <Text style={styles.dueLabel}>{label}</Text>
      <Text style={styles.dueValue}>{value}</Text>
    </View>
  );
}

function PickerModal({
  visible,
  title,
  rows,
  onClose,
  onSelect,
}: {
  visible: boolean;
  title: string;
  rows: { id: string; label: string }[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modalCard}>
          <Text style={styles.cardTitle}>{title}</Text>
          <FlatList
            data={rows}
            keyExtractor={(item) => item.id || 'none'}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.personRow} onPress={() => onSelect(item.id)}>
                <Text>{item.label}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: 170, borderRadius: 12, marginBottom: 12, backgroundColor: '#eee' },
  reg: { fontSize: 28, fontWeight: '800', color: '#4a026f' },
  sub: { color: '#3d0a5c', marginTop: 4, fontSize: 16 },
  meta: { color: '#5c5563', marginTop: 4 },
  section: { fontSize: 16, fontWeight: '800', color: '#4a026f', marginTop: 20, marginBottom: 8 },
  notes: { marginTop: 8, color: '#333' },
  blockBox: { backgroundColor: '#fff6f6', borderColor: '#c62828', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12 },
  blockTitle: { color: '#c62828', fontWeight: '800' },
  blockText: { color: '#c62828', fontWeight: '700', marginTop: 4 },
  warnBox: { backgroundColor: '#fff8f1', borderColor: '#ef6c00', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 },
  warnText: { color: '#ef6c00', fontWeight: '700' },
  okBox: { backgroundColor: '#f1f8f2', borderColor: '#2e7d32', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12 },
  okText: { color: '#2e7d32', fontWeight: '800' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginTop: 8, borderWidth: 1, borderColor: '#e8e8e8' },
  cardTitle: { fontWeight: '700', color: '#222' },
  dueRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#eee' },
  dueLabel: { color: '#5c5563' },
  dueValue: { color: '#222', fontWeight: '600' },
  historyRow: { backgroundColor: '#fff', borderRadius: 10, padding: 10, marginBottom: 8 },
  input: { backgroundColor: '#f7f7f8', borderRadius: 8, padding: 10, marginTop: 8 },
  checkRow: { marginTop: 8 },
  primaryBtn: { backgroundColor: '#4a026f', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: { borderWidth: 1, borderColor: '#4a026f', borderRadius: 10, padding: 10, alignItems: 'center', marginTop: 10 },
  secondaryText: { color: '#4a026f', fontWeight: '700' },
  linkBtn: { alignSelf: 'flex-start', marginTop: 8 },
  linkText: { color: '#4a026f', fontWeight: '700', marginTop: 8 },
  disabled: { opacity: 0.45 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, maxHeight: '70%', padding: 16 },
  personRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },
});
