import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Modal,
  Pressable,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CommonActions, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uploadsService, usersService, useAuthContext, useCompanyContext, vehiclesService } from '@sitesync/shared';
import type { User } from '@sitesync/shared';
import type { UsersStackParamList } from '../../navigation/UsersStack';

type Nav = NativeStackNavigationProp<UsersStackParamList, 'UsersList'>;
type Draft = {
  first_name: string;
  last_name: string;
  email: string;
  role: User['role'];
  photo_url: string;
  is_active: boolean;
};

function initialsForUser(user: User): string {
  const a = user.first_name?.[0] ?? '';
  const b = user.last_name?.[0] ?? '';
  const both = `${a}${b}`.trim();
  return both ? both.toUpperCase() : '?';
}

function UserAvatar({ user, size = 36 }: { user: User; size?: number }) {
  if (user.photo_url) {
    return <Image source={{ uri: user.photo_url }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={styles.avatarText}>{initialsForUser(user)}</Text>
    </View>
  );
}

function UserRow({ item, onOpen }: { item: User; onOpen: (u: User) => void }) {
  return (
    <TouchableOpacity style={styles.item} onPress={() => onOpen(item)} activeOpacity={0.75}>
      <View style={styles.itemMain}>
        <UserAvatar user={item} />
        <View style={styles.itemInfo}>
          <Text style={styles.name} numberOfLines={1}>
            {item.first_name} {item.last_name}
          </Text>
          <Text style={styles.email} numberOfLines={1}>
            {item.email}
          </Text>
        </View>
      </View>
      <View style={styles.itemRight}>
        <Text style={styles.roleTextBadge}>{item.role}</Text>
        <Text style={styles.tapHint}>View / edit</Text>
      </View>
    </TouchableOpacity>
  );
}

function CurrentVehicle({ userId, onOpen }: { userId: string; onOpen: (vehicleId: string) => void }) {
  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['vehicles', 'allocated', userId],
    queryFn: () => vehiclesService.list({ allocated_to: userId }),
  });
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={styles.inputLabel}>Current vehicle</Text>
      {isLoading ? <Text style={styles.modalSubtitle}>Loading vehicle…</Text> : null}
      {!isLoading && vehicles.length === 0 ? <Text style={styles.modalSubtitle}>No vehicle allocated.</Text> : null}
      {vehicles.map((vehicle) => (
        <TouchableOpacity key={vehicle.id} style={styles.vehicleCard} onPress={() => onOpen(vehicle.id)}>
          <Text style={styles.vehicleReg}>{vehicle.registration_display}</Text>
          <Text style={styles.modalSubtitle}>
            {vehicle.make} {vehicle.model}
            {vehicle.block_reasons[0] ? ` · ${vehicle.block_reasons[0].message}` : ''}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function UserEditModal({
  user,
  onClose,
  onSave,
  onDelete,
  onOpenVehicle,
  saving,
  deleting,
}: {
  user: User;
  onClose: () => void;
  onSave: (d: Draft) => Promise<unknown>;
  onDelete: (u: User) => void;
  onOpenVehicle: (vehicleId: string) => void;
  saving: boolean;
  deleting: boolean;
}) {
  const [draft, setDraft] = useState<Draft>({
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    role: user.role,
    photo_url: user.photo_url ?? '',
    is_active: user.is_active,
  });

  const pickPhoto = () => {
    const doUpload = async (uri: string) => {
      const url = await uploadsService.uploadProfilePhoto({ uri, name: 'profile.jpg', type: 'image/jpeg' });
      setDraft((prev) => ({ ...prev, photo_url: url }));
    };
    Alert.alert('Update photo', 'Choose a source', [
      {
        text: 'Camera',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) { Alert.alert('Permission', 'Camera access is required.'); return; }
          const res = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
          if (!res.canceled && res.assets[0]?.uri) await doUpload(res.assets[0].uri);
        },
      },
      {
        text: 'Photo Library',
        onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) { Alert.alert('Permission', 'Photo library access is required.'); return; }
          const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
          if (!res.canceled && res.assets[0]?.uri) await doUpload(res.assets[0].uri);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <UserAvatar user={{ ...user, photo_url: draft.photo_url }} size={58} />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={styles.modalTitle}>
                {draft.first_name} {draft.last_name}
              </Text>
              <Text style={styles.modalSubtitle}>{draft.email}</Text>
            </View>
            <TouchableOpacity style={styles.replaceBtn} onPress={pickPhoto}>
              <Text style={styles.replaceBtnText}>Replace photo</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.inputLabel}>First name</Text>
            <TextInput style={styles.input} value={draft.first_name} onChangeText={(v) => setDraft((p) => ({ ...p, first_name: v }))} />
            <Text style={styles.inputLabel}>Last name</Text>
            <TextInput style={styles.input} value={draft.last_name} onChangeText={(v) => setDraft((p) => ({ ...p, last_name: v }))} />
            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
              value={draft.email}
              onChangeText={(v) => setDraft((p) => ({ ...p, email: v }))}
            />
            <Text style={styles.inputLabel}>Role</Text>
            <View style={styles.roleRow}>
              {(['staff', 'supervisor', 'admin'] as const).map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.roleChip, draft.role === r && styles.roleChipActive]}
                  onPress={() => setDraft((p) => ({ ...p, role: r }))}
                >
                  <Text style={[styles.roleChipText, draft.role === r && styles.roleChipTextActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.activeToggle, draft.is_active && styles.activeToggleOn]}
              onPress={() => setDraft((p) => ({ ...p, is_active: !p.is_active }))}
            >
              <Text style={[styles.activeToggleText, draft.is_active && styles.activeToggleTextOn]}>
                {draft.is_active ? 'Active' : 'Inactive'}
              </Text>
            </TouchableOpacity>
            <CurrentVehicle userId={user.id} onOpen={onOpenVehicle} />
          </ScrollView>
          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(user)} disabled={deleting || saving}>
              {deleting ? <ActivityIndicator color="#c62828" /> : <Text style={styles.deleteText}>Delete user</Text>}
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving || deleting}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, saving && styles.btnDisabled]} onPress={() => void onSave(draft)} disabled={saving || deleting}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save changes</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function UsersScreen() {
  const { user } = useAuthContext();
  const { activeCompanyId } = useCompanyContext();
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<User | null>(null);
  const [adminsOnly, setAdminsOnly] = useState(false);

  const { data: users = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: adminsOnly
      ? ['users', 'admins', activeCompanyId]
      : user?.role === 'superadmin' && activeCompanyId
        ? ['users', activeCompanyId]
        : ['users'],
    queryFn: () =>
      adminsOnly
        ? usersService.getAdmins(user?.role === 'superadmin' ? activeCompanyId ?? undefined : undefined)
        : usersService.getAll(
            user?.role === 'superadmin' && activeCompanyId ? { company_id: activeCompanyId } : undefined
          ),
  });
  const visibleUsers = useMemo(
    () => (user?.role === 'superadmin' ? users.filter((u) => u.id !== user.id) : users.filter((u) => u.role !== 'superadmin')),
    [users, user?.role, user?.id]
  );
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visibleUsers;
    return visibleUsers.filter((u) => `${u.first_name} ${u.last_name} ${u.email} ${u.role}`.toLowerCase().includes(q));
  }, [search, visibleUsers]);

  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: Draft }) =>
      usersService.update(id, {
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        email: draft.email.trim().toLowerCase(),
        role: draft.role,
        photo_url: draft.photo_url,
        is_active: draft.is_active,
      } as Partial<User>),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setSelected(null);
    },
    onError: (e: Error) => Alert.alert('Save failed', e.message || 'Could not update user'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersService.delete(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setSelected(null);
    },
    onError: (e: Error) => Alert.alert('Delete failed', e.message || 'Could not delete user'),
  });

  const confirmDelete = (u: User) => {
    Alert.alert('Delete user', `Delete ${u.first_name} ${u.last_name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(u.id) },
    ]);
  };

  if (isLoading) return <View style={styles.centered}><Text>Loading...</Text></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.header}>User management</Text>
      <Text style={styles.subheader}>Manage your team members and their account settings.</Text>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search users"
          placeholderTextColor="#8c8c8c"
          value={search}
          onChangeText={setSearch}
        />
        <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('CreateUser')}>
          <Text style={styles.addBtnText}>Add user</Text>
        </TouchableOpacity>
        {user?.role === 'superadmin' ? (
          <TouchableOpacity
            style={[styles.addBtn, adminsOnly && { backgroundColor: 'rgba(74,2,111,0.2)' }]}
            onPress={() => setAdminsOnly((v) => !v)}
          >
            <Text style={styles.addBtnText}>{adminsOnly ? 'All users' : 'Admins only'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <FlatList
        data={filteredUsers}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={<Text style={styles.empty}>No users found.</Text>}
        renderItem={({ item }) => <UserRow item={item} onOpen={setSelected} />}
      />
      {selected ? (
        <UserEditModal
          user={selected}
          onClose={() => setSelected(null)}
          onSave={async (draft) => updateMutation.mutateAsync({ id: selected.id, draft })}
          onDelete={confirmDelete}
          onOpenVehicle={(vehicleId) => {
            setSelected(null);
            navigation.dispatch(
              CommonActions.navigate({
                name: 'Vehicles',
                params: { screen: 'VehicleDetail', params: { vehicleId } },
              })
            );
          }}
          saving={updateMutation.isPending}
          deleting={deleteMutation.isPending}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#d8cfe5', padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { fontSize: 28, fontWeight: '700', color: '#161616' },
  subheader: { fontSize: 14, color: '#6f6f78', marginTop: 4, marginBottom: 14 },
  toolbar: { flexDirection: 'row', marginBottom: 14, alignItems: 'center', gap: 10 },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.42)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#2b1f39',
  },
  addBtn: {
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.65)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#2d1b3d',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 4,
  },
  addBtnText: { color: '#301f41', fontWeight: '700' },
  item: {
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.65)',
    padding: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemMain: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  itemInfo: { marginLeft: 10, minWidth: 0, flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: '#222' },
  email: { fontSize: 13, color: '#6d6d76', marginTop: 2 },
  itemRight: { alignItems: 'flex-end', marginLeft: 10 },
  roleTextBadge: {
    borderRadius: 12,
    backgroundColor: '#ececf2',
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700',
    color: '#3f3f46',
    textTransform: 'capitalize',
    overflow: 'hidden',
  },
  tapHint: { color: '#7a7a84', marginTop: 6, fontSize: 12 },
  avatarFallback: { backgroundColor: '#d8d6e8', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#4a026f', fontWeight: '700' },
  empty: { textAlign: 'center', color: '#7a7a84', marginTop: 40 },
  vehicleCard: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  vehicleReg: { fontWeight: '800', color: '#4a026f', fontSize: 16 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  modalCard: {
    width: '100%',
    maxWidth: 600,
    maxHeight: '92%',
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    overflow: 'hidden',
  },
  modalHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ececf1',
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalTitle: { fontSize: 24, fontWeight: '700', color: '#1a1a1a' },
  modalSubtitle: { marginTop: 4, color: '#6f6f78' },
  replaceBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  replaceBtnText: { color: '#1f1f25', fontWeight: '600', fontSize: 12 },
  modalBody: { padding: 16 },
  inputLabel: { color: '#444', fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.45)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#1f1f25',
  },
  roleRow: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 10, flexWrap: 'wrap' },
  roleChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  roleChipActive: { borderColor: '#4a026f', backgroundColor: '#f0e8f8' },
  roleChipText: { color: '#666', textTransform: 'capitalize', fontWeight: '600' },
  roleChipTextActive: { color: '#4a026f' },
  activeToggle: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  activeToggleOn: { borderColor: '#2e7d32', backgroundColor: '#e8f5e9' },
  activeToggleText: { color: '#666', fontWeight: '600' },
  activeToggleTextOn: { color: '#2e7d32' },
  modalFooter: {
    borderTopWidth: 1,
    borderTopColor: '#ececf1',
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deleteBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f2cccc',
    backgroundColor: '#fff5f5',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  deleteText: { color: '#c62828', fontWeight: '700' },
  cancelBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  cancelText: { color: '#444', fontWeight: '600' },
  saveBtn: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.32)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    minWidth: 120,
    alignItems: 'center',
  },
  saveText: { color: '#2b1f39', fontWeight: '700' },
  btnDisabled: { opacity: 0.7 },
});
