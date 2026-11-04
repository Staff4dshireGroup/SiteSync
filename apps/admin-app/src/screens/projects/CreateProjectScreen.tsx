import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  Keyboard,
  Platform,
  Modal,
  Image,
  FlatList,
  Pressable,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import {
  projectsService,
  uploadsService,
  useAuthContext,
  usersService,
} from '@sitesync/shared';
import { XeroProjectLinkPanel } from '../../components/XeroProjectLinkPanel';
import type { ProjectType, User } from '@sitesync/shared';
import type { RouteProp } from '@react-navigation/native';
import type { ProjectsStackParamList } from '../../navigation/ProjectsStack';
import {
  fetchAddressSuggestions,
  fetchPlaceDetails,
  isMapboxConfigured,
  type MapboxSuggestion,
} from '../../lib/mapboxGeocode';

function isCoordinatesOnlyAddress(addr: string | undefined): boolean {
  if (!addr || !addr.trim()) return false;
  const s = addr.trim();
  return /^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(s);
}

/** Parse YYYY-MM-DD for start date; noon local avoids DST edge cases. */
function parseStartDateInput(s: string): Date | null {
  const t = s.trim();
  if (!t) return null;
  const d = new Date(`${t}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Same rule as API `can_be_active`: start on or before today (UTC day). */
function willBeActiveFromStartDate(start: Date): boolean {
  const sd = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const now = new Date();
  const td = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return sd <= td;
}

function userLabel(u: User): string {
  const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
  return name || u.email;
}

function userActive(u: User): boolean {
  return u.is_active !== false;
}

/** Field roles that can be linked to a project (same company as the logged-in admin). */
function isAssignableFieldUser(u: User): boolean {
  return userActive(u) && (u.role === 'staff' || u.role === 'supervisor');
}

const CATEGORIES = [
  'Construction',
  'Maintenance',
  'Demolition',
  'Electrical',
  'Plumbing',
  'HVAC',
  'Roofing',
  'Landscaping',
  'Cleaning',
  'Security',
  'Painting',
  'Carpentry',
  'Other',
] as const;

function WebDateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (React.createElement as Function)('input', {
    type: 'date',
    value: value || '',
    onChange: (e: any) => onChange(e.target.value),
    onMouseDown: (e: any) => e.stopPropagation(),
    style: {
      border: '1px solid #ccc',
      borderRadius: '8px',
      padding: '14px',
      marginBottom: '16px',
      backgroundColor: '#fff',
      fontSize: '15px',
      color: value ? '#333' : '#897c98',
      width: '100%',
      boxSizing: 'border-box',
      cursor: 'pointer',
      display: 'block',
      outline: 'none',
      fontFamily: 'inherit',
    },
  });
}

export function CreateProjectScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<ProjectsStackParamList, 'CreateProject'>>();
  const editingProjectId = route.params?.projectId;
  const isEditMode = !!editingProjectId;
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [allowedRadiusMeters, setAllowedRadiusMeters] = useState('150');
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [projectType, setProjectType] = useState<ProjectType>('regular');
  const [startDate, setStartDate] = useState('');
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [supervisorId, setSupervisorId] = useState<string | null>(null);
  const [assignedStaffId, setAssignedStaffId] = useState<string | null>(null);

  const [addressSuggestions, setAddressSuggestions] = useState<MapboxSuggestion[]>([]);
  const [addressSearchLoading, setAddressSearchLoading] = useState(false);
  const addressSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [supervisorModalOpen, setSupervisorModalOpen] = useState(false);
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [androidDateOpen, setAndroidDateOpen] = useState(false);
  const [iosDateOpen, setIosDateOpen] = useState(false);
  const [iosDateDraft, setIosDateDraft] = useState(new Date());

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersService.getAll(),
  });
  const { data: editingProject } = useQuery({
    queryKey: ['project', editingProjectId],
    queryFn: () => projectsService.getById(editingProjectId!),
    enabled: !!editingProjectId,
  });

  /** Superadmin GET /users returns all companies; restrict dropdowns to the same company as the admin. */
  const companyUsers = useMemo(() => {
    if (!user?.company_id) return users;
    return users.filter((u) => u.company_id === user.company_id);
  }, [users, user?.company_id]);

  const supervisors = useMemo(
    () => companyUsers.filter((u) => u.role === 'supervisor' && userActive(u)),
    [companyUsers]
  );
  /** Staff + supervisors (many teams only use supervisor accounts for field workers). */
  const staffAssignable = useMemo(
    () => companyUsers.filter(isAssignableFieldUser),
    [companyUsers]
  );

  const parsedStart = useMemo(() => parseStartDateInput(startDate), [startDate]);
  useEffect(() => {
    if (!editingProject) return;
    setName(editingProject.name ?? '');
    setAddress(editingProject.address ?? '');
    setLatitude(
      editingProject.latitude != null && !Number.isNaN(editingProject.latitude)
        ? String(editingProject.latitude)
        : ''
    );
    setLongitude(
      editingProject.longitude != null && !Number.isNaN(editingProject.longitude)
        ? String(editingProject.longitude)
        : ''
    );
    setAllowedRadiusMeters(
      editingProject.allowed_radius_meters != null ? String(editingProject.allowed_radius_meters) : '150'
    );
    setCategory(editingProject.category ?? CATEGORIES[0]);
    setProjectType(editingProject.project_type ?? 'regular');
    setStartDate(editingProject.start_date ? formatYYYYMMDD(new Date(editingProject.start_date)) : '');
    setPhotoUris(editingProject.photo_urls ?? []);
    setSupervisorId(editingProject.supervisor_id ?? null);
    setAssignedStaffId(editingProject.assigned_staff_id ?? null);
  }, [editingProject]);

  const formValid = useMemo(() => {
    if (!name.trim()) return false;
    if (!address.trim() || isCoordinatesOnlyAddress(address)) return false;
    if (parsedStart == null) return false;
    if (!isEditMode && photoUris.length < 3) return false;
    return true;
  }, [name, address, parsedStart, photoUris.length, isEditMode]);

  useEffect(() => {
    return () => {
      if (addressSearchTimer.current) clearTimeout(addressSearchTimer.current);
    };
  }, []);

  const onAddressTextChange = (text: string) => {
    setAddress(text);
    if (addressSearchTimer.current) clearTimeout(addressSearchTimer.current);
    if (!isMapboxConfigured() || text.trim().length < 2) {
      setAddressSuggestions([]);
      setAddressSearchLoading(false);
      return;
    }
    setAddressSearchLoading(true);
    addressSearchTimer.current = setTimeout(async () => {
      try {
        const list = await fetchAddressSuggestions(text);
        setAddressSuggestions(list);
      } catch {
        setAddressSuggestions([]);
      } finally {
        setAddressSearchLoading(false);
      }
    }, 350);
  };

  const pickAddressSuggestion = async (s: MapboxSuggestion) => {
    setAddress(s.placeName);
    setAddressSuggestions([]);
    Keyboard.dismiss();
    try {
      const details = await fetchPlaceDetails(s.id);
      if (details) {
        setAddress(details.placeName);
        setLatitude(String(details.center[1]));
        setLongitude(String(details.center[0]));
      }
    } catch {
      // keep the short description already set; coordinates unavailable
    }
  };

  const openStartDatePicker = () => {
    const base = parsedStart ?? new Date();
    setIosDateDraft(base);
    if (Platform.OS === 'android') {
      setAndroidDateOpen(true);
    } else {
      setIosDateOpen(true);
    }
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const lat = latitude.trim() ? Number(latitude) : undefined;
      const lng = longitude.trim() ? Number(longitude) : undefined;
      const radiusRaw = allowedRadiusMeters.trim() ? Number(allowedRadiusMeters) : 150;
      const radius =
        radiusRaw != null && !Number.isNaN(radiusRaw) && radiusRaw > 0 ? radiusRaw : 150;
      if (isCoordinatesOnlyAddress(address)) {
        throw new Error('Address cannot be coordinates only; enter a real address.');
      }
      if (!isEditMode && photoUris.length < 3) {
        throw new Error('Add at least 3 site photos.');
      }
      if (!address.trim()) {
        throw new Error('Enter a full street address.');
      }
      if (parsedStart == null) {
        throw new Error('Enter a valid start date (YYYY-MM-DD).');
      }
      const urls = await Promise.all(
        photoUris.map((uri, i) =>
          uri.startsWith('http://') || uri.startsWith('https://')
            ? Promise.resolve(uri)
            : uploadsService.uploadChatAttachment({
                uri,
                name: `site-${i + 1}.jpg`,
                type: 'image/jpeg',
              })
        )
      );
      const payload = {
        name: name.trim(),
        address: address.trim(),
        latitude: lat != null && !Number.isNaN(lat) ? lat : undefined,
        longitude: lng != null && !Number.isNaN(lng) ? lng : undefined,
        allowed_radius_meters: radius,
        project_type: projectType,
        category: category.trim() || undefined,
        start_date: parsedStart.toISOString(),
        photo_urls: urls,
        created_by_user_id: user?.id,
        supervisor_id: supervisorId ?? null,
        assigned_staff_id: assignedStaffId ?? null,
      };
      return isEditMode && editingProjectId
        ? projectsService.update(editingProjectId, payload)
        : projectsService.create(payload, { userId: user?.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      Alert.alert('Saved', isEditMode ? 'Project updated' : 'Project created');
      navigation.goBack();
    },
    onError: (e: Error) => Alert.alert('Error', e.message || 'Could not save project'),
  });

  const addPhoto = () => {
    const addFromCamera = async () => {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission', 'Camera access is required.'); return; }
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
      if (!res.canceled && res.assets[0]?.uri) {
        setPhotoUris((prev) => Array.from(new Set([...prev, res.assets[0].uri])));
      }
    };
    const addFromLibrary = async () => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission', 'Photo library access is required.'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: 12, quality: 0.85 });
      if (!res.canceled && res.assets.length > 0) {
        const incoming = res.assets.map((a) => a.uri).filter(Boolean);
        setPhotoUris((prev) => Array.from(new Set([...prev, ...incoming])));
      }
    };
    Alert.alert('Add photo', 'Choose a source', [
      { text: 'Camera', onPress: () => void addFromCamera() },
      { text: 'Photo Library', onPress: () => void addFromLibrary() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const removePhoto = (index: number) => {
    setPhotoUris((prev) => prev.filter((_, i) => i !== index));
  };

  const selectedSupervisor = supervisors.find((u) => u.id === supervisorId);
  const selectedStaff = staffAssignable.find((u) => u.id === assignedStaffId);

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Project / site name *</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Riverside maintenance"
        placeholderTextColor="#897c98"
      />

      <Text style={styles.label}>Supervisor</Text>
      <Text style={styles.hint}>Optional — must have supervisor role in your company.</Text>
      <TouchableOpacity
        style={styles.selectBtn}
        onPress={() => setSupervisorModalOpen(true)}
        disabled={usersLoading}
      >
        <Text style={styles.selectBtnText}>
          {selectedSupervisor ? userLabel(selectedSupervisor) : 'None — tap to assign'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.label}>Assigned staff</Text>
      <Text style={styles.hint}>
        Optional — users with role Staff or Supervisor in your company (inactive users are hidden).
      </Text>
      <TouchableOpacity
        style={styles.selectBtn}
        onPress={() => setStaffModalOpen(true)}
        disabled={usersLoading}
      >
        <Text style={styles.selectBtnText}>
          {selectedStaff
            ? `${userLabel(selectedStaff)} (${selectedStaff.role})`
            : 'None — tap to assign'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.label}>Address *</Text>
      <View style={styles.addressWrap}>
        <View style={styles.addressInputRow}>
          <TextInput
            style={[styles.input, styles.addressInput]}
            value={address}
            onChangeText={onAddressTextChange}
            placeholder="Full street address"
            placeholderTextColor="#897c98"
            autoCorrect={false}
          />
          {addressSearchLoading ? (
            <ActivityIndicator style={styles.suggestSpinner} size="small" color="#4a026f" />
          ) : null}
        </View>
        {addressSuggestions.length > 0 ? (
          <View style={styles.suggestBox}>
            <FlatList
              data={addressSuggestions}
              keyExtractor={(item) => item.id}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestRow}
                  onPress={() => pickAddressSuggestion(item)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.suggestText} numberOfLines={2}>
                    {item.placeName}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        ) : null}
      </View>


      <Text style={styles.label}>Attendance radius (meters)</Text>
      <Text style={styles.hint}>
        Staff must be within this distance of the site coordinates to sign in or out.
      </Text>
      <TextInput
        style={styles.input}
        value={allowedRadiusMeters}
        onChangeText={setAllowedRadiusMeters}
        placeholder="150"
        keyboardType="number-pad"
        placeholderTextColor="#897c98"
      />

      <Text style={styles.label}>Project type</Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.chip, projectType === 'regular' && styles.chipOn]}
          onPress={() => setProjectType('regular')}
        >
          <Text style={[styles.chipText, projectType === 'regular' && styles.chipTextOn]}>
            Regular
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, projectType === 'callout' && styles.chipOn]}
          onPress={() => setProjectType('callout')}
        >
          <Text style={[styles.chipText, projectType === 'callout' && styles.chipTextOn]}>
            Callout
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Category *</Text>
      <TouchableOpacity style={styles.selectBtn} onPress={() => setCategoryModalOpen(true)}>
        <Text style={styles.selectBtnText}>{category}</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Start date *</Text>
      <Text style={styles.hint}>
        Used for active status: the project is only active when this date is today or in the past
        (same as API field can_be_active).
      </Text>
      {Platform.OS === 'web' ? (
        <WebDateInput value={startDate} onChange={setStartDate} />
      ) : (
        <TouchableOpacity style={styles.selectBtn} onPress={openStartDatePicker}>
          <Text style={[styles.selectBtnText, !startDate.trim() && styles.selectBtnPlaceholder]}>
            {startDate.trim() ? startDate : 'Tap to open calendar'}
          </Text>
        </TouchableOpacity>
      )}
      {parsedStart ? (
        <Text style={styles.statusHint}>
          {willBeActiveFromStartDate(parsedStart)
            ? 'This start date allows the project to be active now.'
            : 'Project will become active on the start date (not active until then).'}
        </Text>
      ) : startDate.trim() ? (
        <Text style={styles.warnText}>Enter a valid date in YYYY-MM-DD format.</Text>
      ) : null}

      {Platform.OS === 'android' && androidDateOpen ? (
        <DateTimePicker
          value={parsedStart ?? new Date()}
          mode="date"
          display="default"
          onChange={(e, selected) => {
            setAndroidDateOpen(false);
            if (e.type === 'set' && selected) {
              setStartDate(formatYYYYMMDD(selected));
            }
          }}
        />
      ) : null}

      <Modal visible={iosDateOpen} transparent animationType="slide">
        <View style={styles.dateModalRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setIosDateOpen(false)} />
          <View style={styles.dateSheet}>
            <View style={styles.dateSheetHeader}>
              <TouchableOpacity onPress={() => setIosDateOpen(false)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.dateSheetTitle}>Start date</Text>
              <TouchableOpacity
                onPress={() => {
                  setStartDate(formatYYYYMMDD(iosDateDraft));
                  setIosDateOpen(false);
                }}
              >
                <Text style={styles.modalDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={iosDateDraft}
              mode="date"
              display="spinner"
              onChange={(_, d) => {
                if (d) setIosDateDraft(d);
              }}
              style={styles.iosPicker}
            />
          </View>
        </View>
      </Modal>

      <Text style={styles.label}>Site photos (min 3) — {photoUris.length} selected</Text>
      <Text style={styles.hint}>Preview below. Add multiple images from your library.</Text>
      <TouchableOpacity style={styles.addPhoto} onPress={addPhoto}>
        <Text style={styles.addPhotoText}>Add photo</Text>
      </TouchableOpacity>
      {photoUris.length > 0 ? (
        <View style={styles.photoGrid}>
          {photoUris.map((uri, i) => (
            <View key={uri + i} style={styles.photoThumbWrap}>
              <Image source={{ uri }} style={styles.photoThumb} resizeMode="cover" />
              <TouchableOpacity style={styles.removeThumb} onPress={() => removePhoto(i)}>
                <Text style={styles.removeThumbText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}

      {isEditMode && editingProject && (user?.role === 'admin' || user?.role === 'superadmin') ? (
        <XeroProjectLinkPanel companyId={editingProject.company_id} projectId={editingProject.id} />
      ) : null}

      <TouchableOpacity
        style={[styles.saveBtn, (!formValid || mutation.isPending) && styles.saveDisabled]}
        disabled={!formValid || mutation.isPending}
        onPress={() => mutation.mutate()}
      >
        {mutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveText}>{isEditMode ? 'Save changes' : 'Create project'}</Text>
        )}
      </TouchableOpacity>

      <Modal visible={categoryModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setCategoryModalOpen(false)} />
          <View style={styles.modalCard} pointerEvents="box-none">
            <Text style={styles.modalTitle}>Category</Text>
            <FlatList
              data={[...CATEGORIES]}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalRow, item === category && styles.modalRowOn]}
                  onPress={() => {
                    setCategory(item);
                    setCategoryModalOpen(false);
                  }}
                >
                  <Text style={[styles.modalRowText, item === category && styles.modalRowTextOn]}>
                    {item}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={supervisorModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSupervisorModalOpen(false)} />
          <View style={styles.modalCard} pointerEvents="box-none">
            <Text style={styles.modalTitle}>Supervisor</Text>
            <FlatList
              data={[
                { id: '__none__', label: 'None' },
                ...supervisors.map((u) => ({ id: u.id, label: userLabel(u) })),
              ]}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalRow}
                  onPress={() => {
                    setSupervisorId(item.id === '__none__' ? null : item.id);
                    setSupervisorModalOpen(false);
                  }}
                >
                  <Text style={styles.modalRowText}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={staffModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setStaffModalOpen(false)} />
          <View style={styles.modalCard} pointerEvents="box-none">
            <Text style={styles.modalTitle}>Assigned staff</Text>
            <FlatList
              data={[
                { id: '__none__', label: 'None', role: '' },
                ...staffAssignable.map((u) => ({
                  id: u.id,
                  label: userLabel(u),
                  role: u.role,
                })),
              ]}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={styles.modalEmpty}>
                  No staff or supervisors in your company. Check user roles (Staff / Supervisor) and
                  that accounts are active.
                </Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalRow}
                  onPress={() => {
                    setAssignedStaffId(item.id === '__none__' ? null : item.id);
                    setStaffModalOpen(false);
                  }}
                >
                  <Text style={styles.modalRowText}>
                    {item.id === '__none__' ? item.label : `${item.label} (${item.role})`}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#f5f5f5', padding: 20, paddingBottom: 40 },
  label: { fontSize: 14, fontWeight: '600', color: '#4a026f', marginBottom: 6 },
  hint: { fontSize: 12, color: '#897c98', marginBottom: 8, marginTop: -8 },
  statusHint: { fontSize: 13, color: '#2e7d32', marginBottom: 12, marginTop: -12 },
  warnText: { fontSize: 13, color: '#c62828', marginBottom: 12, marginTop: -12 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    backgroundColor: '#fff',
  },
  selectBtn: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
    backgroundColor: '#fff',
  },
  selectBtnText: { fontSize: 15, color: '#333' },
  selectBtnPlaceholder: { color: '#897c98' },
  row: { flexDirection: 'row', marginBottom: 8, flexWrap: 'wrap' },
  half: { flex: 1, minWidth: 120 },
  addressWrap: { marginBottom: 16 },
  addressInputRow: { position: 'relative' },
  addressInput: { marginBottom: 0, paddingRight: 36 },
  suggestSpinner: { position: 'absolute', right: 12, top: 12 },
  suggestBox: {
    marginTop: 8,
    maxHeight: 220,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.12)' } as object,
      default: {
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.12,
        shadowRadius: 3,
      },
    }),
  },
  suggestRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  suggestText: { fontSize: 14, color: '#333' },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
    marginRight: 10,
    marginBottom: 8,
  },
  chipOn: { borderColor: '#4a026f', backgroundColor: '#ede7f6' },
  chipText: { color: '#707173', fontWeight: '600' },
  chipTextOn: { color: '#4a026f' },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
    marginHorizontal: -5,
  },
  photoThumbWrap: {
    width: 96,
    height: 96,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    margin: 5,
  },
  photoThumb: { width: '100%', height: '100%', backgroundColor: '#e0e0e0' },
  removeThumb: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeThumbText: { color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 22 },
  addPhoto: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4a026f',
    marginBottom: 8,
  },
  addPhotoText: { color: '#4a026f', fontWeight: '600' },
  saveBtn: {
    backgroundColor: '#4a026f',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  saveDisabled: { opacity: 0.7 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    maxHeight: '70%',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 8,
    zIndex: 1,
  },
  dateModalRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#4a026f',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  modalRowOn: { backgroundColor: '#ede7f6' },
  modalRowText: { fontSize: 16, color: '#333' },
  modalRowTextOn: { color: '#4a026f', fontWeight: '600' },
  modalEmpty: {
    padding: 20,
    fontSize: 14,
    color: '#897c98',
    textAlign: 'center',
  },
  dateSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
    zIndex: 1,
  },
  dateSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  dateSheetTitle: { fontSize: 16, fontWeight: '600', color: '#333' },
  modalCancel: { fontSize: 16, color: '#666' },
  modalDone: { fontSize: 16, fontWeight: '600', color: '#4a026f' },
  iosPicker: { alignSelf: 'center' },
  webDateWrap: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 16,
  },
});
