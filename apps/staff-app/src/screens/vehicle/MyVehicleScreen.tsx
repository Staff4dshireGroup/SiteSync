import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { vehiclesService, VEHICLE_FUEL_LABELS, VEHICLE_TYPE_LABELS } from '@sitesync/shared';
import type { ExpiryItem, Vehicle } from '@sitesync/shared';
import { messageFromError } from '../../lib/apiError';

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

export function MyVehicleScreen() {
  const queryClient = useQueryClient();
  const { data: vehicles = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['vehicles', 'mine'],
    queryFn: () => vehiclesService.mine(),
  });

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#4a026f" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.heading}>My vehicle</Text>
      {vehicles.length === 0 ? (
        <Text style={styles.empty}>No vehicle is allocated to you. Ask an admin or supervisor if you were expecting one.</Text>
      ) : (
        vehicles.map((vehicle) => (
          <VehicleCard
            key={vehicle.id}
            vehicle={vehicle}
            onChanged={async () => {
              await queryClient.invalidateQueries({ queryKey: ['vehicles', 'mine'] });
            }}
          />
        ))
      )}
    </ScrollView>
  );
}

function VehicleCard({ vehicle, onChanged }: { vehicle: Vehicle; onChanged: () => Promise<void> }) {
  const [mileage, setMileage] = useState(vehicle.current_mileage?.toString() ?? '');
  const [hasDefects, setHasDefects] = useState(false);
  const [unsafe, setUnsafe] = useState(false);
  const [notes, setNotes] = useState('');
  const warnings = warningItems(vehicle);

  const check = useMutation({
    mutationFn: () =>
      vehiclesService.addCheck(vehicle.id, {
        mileage: Number(mileage),
        has_defects: hasDefects,
        unsafe: hasDefects && unsafe,
        notes: notes.trim() || undefined,
      }),
    onSuccess: async (updated) => {
      setHasDefects(false);
      setUnsafe(false);
      setNotes('');
      await onChanged();
      if (updated.usable_today) {
        Alert.alert('Check saved', 'This vehicle is cleared for use today. Confirm send-out when you leave.');
      } else {
        Alert.alert('Check saved', updated.block_reasons.map((reason) => reason.message).join('\n') || 'This vehicle cannot be sent out.');
      }
    },
    onError: (error: unknown) => Alert.alert('Check not saved', messageFromError(error, 'Could not save the check')),
  });

  const sendOut = useMutation({
    mutationFn: () => vehiclesService.useToday(vehicle.id),
    onSuccess: () => Alert.alert('Sent out', `${vehicle.registration_display} is cleared for today.`),
    onError: (error: unknown) => Alert.alert('Cannot send out', messageFromError(error, 'This vehicle cannot be used today')),
  });

  return (
    <View style={styles.card}>
      <Text style={styles.reg}>{vehicle.registration_display}</Text>
      <Text style={styles.sub}>
        {vehicle.make} {vehicle.model}
      </Text>
      <Text style={styles.meta}>
        {VEHICLE_TYPE_LABELS[vehicle.type]} · {vehicle.colour} · {VEHICLE_FUEL_LABELS[vehicle.fuel_type]}
      </Text>
      {vehicle.project_name ? <Text style={styles.meta}>Project: {vehicle.project_name}</Text> : null}

      <Text style={styles.section}>Key dates</Text>
      <Due label="MOT" value={showDate(vehicle.mot_due)} />
      <Due label="Road tax" value={showDate(vehicle.road_tax_due)} />
      <Due label="Insurance" value={showDate(vehicle.insurance_expiry)} />
      <Due label="Service" value={showDate(vehicle.service_due_date)} />

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

      <Text style={styles.section}>Today’s start-of-day check</Text>
      {vehicle.today_check ? (
        <Text style={styles.meta}>
          Latest check: {vehicle.today_check.result === 'pass' ? 'Passed' : 'Failed'} at {vehicle.today_check.mileage} miles
          {vehicle.today_check.notes ? ` · ${vehicle.today_check.notes}` : ''}
        </Text>
      ) : (
        <Text style={styles.meta}>No check has been submitted today. One is required before this vehicle can be used.</Text>
      )}
      <Text style={styles.label}>Mileage</Text>
      <TextInput style={styles.input} value={mileage} onChangeText={setMileage} keyboardType="number-pad" placeholder="Odometer" />
      <TouchableOpacity style={styles.checkRow} onPress={() => setHasDefects((value) => !value)}>
        <Text style={styles.meta}>{hasDefects ? '☑' : '☐'} Defects</Text>
      </TouchableOpacity>
      {hasDefects ? (
        <>
          <TouchableOpacity style={styles.checkRow} onPress={() => setUnsafe((value) => !value)}>
            <Text style={styles.meta}>{unsafe ? '☑' : '☐'} Unsafe / off road</Text>
          </TouchableOpacity>
          <Text style={styles.label}>Defect notes</Text>
          <TextInput
            style={[styles.input, styles.notes]}
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Describe the defect"
          />
        </>
      ) : null}
      <TouchableOpacity style={styles.primaryBtn} disabled={check.isPending} onPress={() => check.mutate()}>
        {check.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Submit check</Text>}
      </TouchableOpacity>

      <Text style={styles.section}>Defects</Text>
      {(vehicle.open_defects ?? []).length === 0 ? (
        <Text style={styles.meta}>No open unsafe defects. Report one with today’s check if the vehicle should stay off the road.</Text>
      ) : (
        (vehicle.open_defects ?? []).map((defect) => (
          <View key={defect.id} style={styles.blockBox}>
            <Text style={styles.blockTitle}>Open unsafe defect</Text>
            <Text style={styles.blockText}>{defect.notes}</Text>
            <Text style={styles.meta}>An admin has to resolve this before the vehicle can be sent out.</Text>
          </View>
        ))
      )}

      <TouchableOpacity
        style={[styles.primaryBtn, !vehicle.usable_today && styles.disabled]}
        disabled={sendOut.isPending}
        onPress={() => sendOut.mutate()}
      >
        {sendOut.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Send out</Text>}
      </TouchableOpacity>
      {vehicle.usable_today && vehicle.today_check?.result === 'fail' ? (
        <Text style={styles.meta}>An admin resolved the unsafe defect from today’s check, so the vehicle can be sent out.</Text>
      ) : null}
      {!vehicle.usable_today ? (
        <Text style={styles.meta}>Send out stays blocked until the reasons above are cleared. The server checks again when you tap it.</Text>
      ) : null}
    </View>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 24, fontWeight: '800', color: '#4a026f', marginBottom: 12 },
  empty: { color: '#5c5563', lineHeight: 22 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#e8e8e8' },
  reg: { fontSize: 28, fontWeight: '800', color: '#4a026f' },
  sub: { fontSize: 18, color: '#3d0a5c', marginTop: 2 },
  meta: { color: '#5c5563', marginTop: 4 },
  section: { fontSize: 16, fontWeight: '800', color: '#4a026f', marginTop: 16, marginBottom: 6 },
  dueRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  dueLabel: { color: '#5c5563' },
  dueValue: { color: '#222', fontWeight: '600' },
  blockBox: { backgroundColor: '#fff6f6', borderColor: '#c62828', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12 },
  blockTitle: { color: '#c62828', fontWeight: '800' },
  blockText: { color: '#c62828', fontWeight: '700', marginTop: 4 },
  warnBox: { backgroundColor: '#fff8f1', borderColor: '#ef6c00', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 },
  warnText: { color: '#ef6c00', fontWeight: '700' },
  okBox: { backgroundColor: '#f1f8f2', borderColor: '#2e7d32', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12 },
  okText: { color: '#2e7d32', fontWeight: '800' },
  label: { color: '#444', fontSize: 12, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  input: { backgroundColor: '#f7f7f8', borderRadius: 8, padding: 10, color: '#222' },
  notes: { minHeight: 80, textAlignVertical: 'top' },
  checkRow: { marginTop: 8 },
  primaryBtn: { backgroundColor: '#4a026f', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 14 },
  primaryText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.7 },
});
