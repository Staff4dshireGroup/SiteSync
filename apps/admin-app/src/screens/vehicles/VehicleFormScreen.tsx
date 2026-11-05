import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  FlatList,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  hasCapability,
  projectsService,
  uploadsService,
  useAuthContext,
  vehiclesService,
  VEHICLE_FUEL_LABELS,
  VEHICLE_STATUS_LABELS,
  VEHICLE_TYPE_LABELS,
} from '@sitesync/shared';
import type { Project, VehicleFuelType, VehicleStatus, VehicleType, VehicleWrite } from '@sitesync/shared';
import type { VehiclesStackParamList } from '../../navigation/VehiclesStack';
import { messageFromError } from '../../lib/apiError';

type Route = RouteProp<VehiclesStackParamList, 'VehicleForm'>;
type Nav = NativeStackNavigationProp<VehiclesStackParamList, 'VehicleForm'>;

type Draft = {
  registration: string;
  make: string;
  model: string;
  type: VehicleType;
  colour: string;
  fuel_type: VehicleFuelType;
  vin: string;
  mot_due: string;
  road_tax_due: string;
  insurance_expiry: string;
  service_due_date: string;
  service_due_mileage: string;
  current_mileage: string;
  notes: string;
  status: VehicleStatus;
  photo_url: string;
  project_id: string;
};

const EMPTY: Draft = {
  registration: '',
  make: '',
  model: '',
  type: 'van',
  colour: '',
  fuel_type: 'diesel',
  vin: '',
  mot_due: '',
  road_tax_due: '',
  insurance_expiry: '',
  service_due_date: '',
  service_due_mileage: '',
  current_mileage: '',
  notes: '',
  status: 'active',
  photo_url: '',
  project_id: '',
};

function fromVehicle(vehicle: Awaited<ReturnType<typeof vehiclesService.getById>>): Draft {
  return {
    registration: vehicle.registration_display,
    make: vehicle.make,
    model: vehicle.model,
    type: vehicle.type,
    colour: vehicle.colour,
    fuel_type: vehicle.fuel_type,
    vin: vehicle.vin ?? '',
    mot_due: vehicle.mot_due ?? '',
    road_tax_due: vehicle.road_tax_due ?? '',
    insurance_expiry: vehicle.insurance_expiry ?? '',
    service_due_date: vehicle.service_due_date ?? '',
    service_due_mileage: vehicle.service_due_mileage?.toString() ?? '',
    current_mileage: vehicle.current_mileage?.toString() ?? '',
    notes: vehicle.notes ?? '',
    status: vehicle.status,
    photo_url: vehicle.photo_url ?? '',
    project_id: vehicle.project_id ?? '',
  };
}

function optionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number(trimmed);
}

function toPayload(draft: Draft): VehicleWrite {
  return {
    registration: draft.registration.trim(),
    make: draft.make.trim(),
    model: draft.model.trim(),
    type: draft.type,
    colour: draft.colour.trim(),
    fuel_type: draft.fuel_type,
    vin: draft.vin.trim() || null,
    mot_due: draft.mot_due.trim() || null,
    road_tax_due: draft.road_tax_due.trim() || null,
    insurance_expiry: draft.insurance_expiry.trim() || null,
    service_due_date: draft.service_due_date.trim() || null,
    service_due_mileage: optionalInt(draft.service_due_mileage),
    current_mileage: optionalInt(draft.current_mileage),
    notes: draft.notes.trim() || null,
    status: draft.status,
    photo_url: draft.photo_url.trim() || null,
    project_id: draft.project_id || null,
  };
}

export function VehicleFormScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const vehicleId = route.params?.vehicleId;
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [ready, setReady] = useState(!vehicleId);
  const [projectOpen, setProjectOpen] = useState(false);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsService.getAll(),
  });

  const { data: existing } = useQuery({
    queryKey: ['vehicles', vehicleId],
    queryFn: () => vehiclesService.getById(vehicleId!),
    enabled: Boolean(vehicleId),
  });

  useEffect(() => {
    if (existing && !ready) {
      setDraft(fromVehicle(existing));
      setReady(true);
    }
  }, [existing, ready]);

  const save = useMutation({
    mutationFn: (payload: VehicleWrite) =>
      vehicleId ? vehiclesService.update(vehicleId, payload) : vehiclesService.create(payload),
    onSuccess: async (vehicle) => {
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      navigation.replace('VehicleDetail', { vehicleId: vehicle.id });
    },
    onError: (error: unknown) => Alert.alert('Could not save vehicle', messageFromError(error, 'Save failed')),
  });

  const archive = useMutation({
    mutationFn: () => vehiclesService.archive(vehicleId!, !existing?.archived_at),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      navigation.goBack();
    },
    onError: (error: unknown) => Alert.alert('Could not archive', messageFromError(error, 'Archive failed')),
  });

  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const pickPhoto = () => {
    const upload = async (uri: string) => {
      const url = await uploadsService.uploadVehiclePhoto({ uri, name: 'vehicle.jpg', type: 'image/jpeg' });
      set({ photo_url: url });
    };
    Alert.alert('Vehicle photo', 'Choose a source', [
      {
        text: 'Camera',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) return Alert.alert('Permission', 'Camera access is required.');
          const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
          if (!result.canceled && result.assets[0]?.uri) await upload(result.assets[0].uri);
        },
      },
      {
        text: 'Photo library',
        onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) return Alert.alert('Permission', 'Photo library access is required.');
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
          if (!result.canceled && result.assets[0]?.uri) await upload(result.assets[0].uri);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (!hasCapability(user?.role, 'manage_vehicles')) {
    return (
      <View style={styles.centered}>
        <Text style={styles.help}>Only admins can add or edit vehicles.</Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#4a026f" />
      </View>
    );
  }

  const selectedProject = projects.find((project) => project.id === draft.project_id);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.help}>Registration is stored in UK format and must be unique in the company. Dates use YYYY-MM-DD.</Text>
      {draft.photo_url ? <Image source={{ uri: draft.photo_url }} style={styles.photo} /> : null}
      <TouchableOpacity style={styles.secondaryBtn} onPress={pickPhoto}>
        <Text style={styles.secondaryText}>{draft.photo_url ? 'Replace photo' : 'Add photo'}</Text>
      </TouchableOpacity>
      <Field label="Registration" value={draft.registration} onChangeText={(registration) => set({ registration })} autoCapitalize="characters" />
      <Field label="Make" value={draft.make} onChangeText={(make) => set({ make })} />
      <Field label="Model" value={draft.model} onChangeText={(model) => set({ model })} />
      <Text style={styles.label}>Type</Text>
      <ChoiceRow options={Object.keys(VEHICLE_TYPE_LABELS) as VehicleType[]} labels={VEHICLE_TYPE_LABELS} value={draft.type} onChange={(type) => set({ type })} />
      <Field label="Colour" value={draft.colour} onChangeText={(colour) => set({ colour })} />
      <Text style={styles.label}>Fuel</Text>
      <ChoiceRow options={Object.keys(VEHICLE_FUEL_LABELS) as VehicleFuelType[]} labels={VEHICLE_FUEL_LABELS} value={draft.fuel_type} onChange={(fuel_type) => set({ fuel_type })} />
      <Field label="VIN (optional)" value={draft.vin} onChangeText={(vin) => set({ vin })} autoCapitalize="characters" />
      <Field label="MOT due" value={draft.mot_due} onChangeText={(mot_due) => set({ mot_due })} placeholder="YYYY-MM-DD" />
      <Field label="Road tax due" value={draft.road_tax_due} onChangeText={(road_tax_due) => set({ road_tax_due })} placeholder="YYYY-MM-DD" />
      <Field label="Insurance expiry" value={draft.insurance_expiry} onChangeText={(insurance_expiry) => set({ insurance_expiry })} placeholder="YYYY-MM-DD" />
      <Field label="Service due date" value={draft.service_due_date} onChangeText={(service_due_date) => set({ service_due_date })} placeholder="YYYY-MM-DD" />
      <Field label="Service due mileage" value={draft.service_due_mileage} onChangeText={(service_due_mileage) => set({ service_due_mileage })} keyboardType="number-pad" />
      <Field label="Current mileage" value={draft.current_mileage} onChangeText={(current_mileage) => set({ current_mileage })} keyboardType="number-pad" />
      <Text style={styles.label}>Status</Text>
      <ChoiceRow options={Object.keys(VEHICLE_STATUS_LABELS) as VehicleStatus[]} labels={VEHICLE_STATUS_LABELS} value={draft.status} onChange={(status) => set({ status })} />
      <Text style={styles.label}>Project</Text>
      <TouchableOpacity style={styles.input} onPress={() => setProjectOpen(true)}>
        <Text style={selectedProject ? styles.inputText : styles.placeholder}>{selectedProject?.name ?? 'No project'}</Text>
      </TouchableOpacity>
      <Field label="Notes" value={draft.notes} onChangeText={(notes) => set({ notes })} multiline />
      <TouchableOpacity style={styles.primaryBtn} disabled={save.isPending} onPress={() => save.mutate(toPayload(draft))}>
        {save.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{vehicleId ? 'Save changes' : 'Add vehicle'}</Text>}
      </TouchableOpacity>
      {vehicleId ? (
        <TouchableOpacity
          style={styles.secondaryBtn}
          disabled={archive.isPending}
          onPress={() =>
            Alert.alert(existing?.archived_at ? 'Restore vehicle' : 'Archive vehicle', 'Archived vehicles stay on record and are not deleted.', [
              { text: 'Cancel', style: 'cancel' },
              { text: existing?.archived_at ? 'Restore' : 'Archive', style: 'destructive', onPress: () => archive.mutate() },
            ])
          }
        >
          <Text style={styles.secondaryText}>{existing?.archived_at ? 'Restore from archive' : 'Archive vehicle'}</Text>
        </TouchableOpacity>
      ) : null}
      <ProjectPicker
        visible={projectOpen}
        projects={projects.filter((project) => !project.archived && !project.completed)}
        onClose={() => setProjectOpen(false)}
        onSelect={(projectId) => {
          set({ project_id: projectId });
          setProjectOpen(false);
        }}
      />
    </ScrollView>
  );
}

function Field({
  label,
  ...input
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={[styles.input, input.multiline && styles.multiline]} placeholderTextColor="#9a9aa3" {...input} />
    </>
  );
}

function ChoiceRow<T extends string>({
  options,
  labels,
  value,
  onChange,
}: {
  options: T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.choices}>
      {options.map((option) => (
        <TouchableOpacity key={option} style={[styles.chip, value === option && styles.chipOn]} onPress={() => onChange(option)}>
          <Text style={[styles.chipText, value === option && styles.chipTextOn]}>{labels[option]}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ProjectPicker({
  visible,
  projects,
  onClose,
  onSelect,
}: {
  visible: boolean;
  projects: Project[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modalCard}>
          <TouchableOpacity style={styles.personRow} onPress={() => onSelect('')}>
            <Text>No project</Text>
          </TouchableOpacity>
          <FlatList
            data={projects}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.personRow} onPress={() => onSelect(item.id)}>
                <Text>{item.name}</Text>
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
  content: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  help: { color: '#5c5563', marginBottom: 12 },
  photo: { width: '100%', height: 160, borderRadius: 12, marginBottom: 8, backgroundColor: '#eee' },
  label: { color: '#444', fontSize: 12, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  inputText: { color: '#222' },
  placeholder: { color: '#9a9aa3' },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#c6b4d3', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#4a026f', borderColor: '#4a026f' },
  chipText: { color: '#5e4f6c', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  primaryBtn: { backgroundColor: '#4a026f', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 18 },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: { borderWidth: 1, borderColor: '#4a026f', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 10 },
  secondaryText: { color: '#4a026f', fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, maxHeight: '70%', padding: 16 },
  personRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
});
