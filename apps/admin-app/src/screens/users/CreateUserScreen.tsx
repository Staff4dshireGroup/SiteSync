import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { companyInvitationsService, uploadsService, usersService, useAuthContext, useCompanyContext } from '@sitesync/shared';
import type { UserRole } from '@sitesync/shared';

const ROLES: UserRole[] = ['staff', 'supervisor', 'admin'];

export function CreateUserScreen() {
  const { user } = useAuthContext();
  const { companies, activeCompanyId } = useCompanyContext();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<UserRole>('staff');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('staff');
  const [generatedCode, setGeneratedCode] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(activeCompanyId ?? null);
  const [inviteCompanyId, setInviteCompanyId] = useState<string | null>(activeCompanyId ?? null);

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission', 'Photo library access is required.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
    });
    if (!res.canceled && res.assets[0]?.uri) {
      setPhotoUri(res.assets[0].uri);
    }
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const photoUrl = photoUri
        ? await uploadsService.uploadProfilePhoto({
            uri: photoUri,
            name: 'profile.jpg',
            type: 'image/jpeg',
          })
        : undefined;
      return usersService.create({
        email: email.trim().toLowerCase(),
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        role,
        photo_url: photoUrl,
        ...(user?.role === 'superadmin' && companyId ? { company_id: companyId } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      Alert.alert('Saved', 'User created');
      navigation.goBack();
    },
    onError: (e: Error) => {
      const serverMsg = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      Alert.alert('Error', serverMsg || e.message || 'Could not create user');
    },
  });
  const inviteMutation = useMutation({
    mutationFn: () => {
      if (user?.role === 'superadmin' && !inviteCompanyId) {
        throw new Error('Please select a company for this invitation');
      }
      return companyInvitationsService.create({
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        ...(user?.role === 'superadmin' && inviteCompanyId ? { company_id: inviteCompanyId } : {}),
      });
    },
    onSuccess: async (data) => {
      setGeneratedCode(data.token);
      await Clipboard.setStringAsync(data.token);
      Alert.alert(
        'Code generated',
        data.email_sent
          ? 'Invitation code copied to clipboard and emailed to the invitee.'
          : 'Invitation code copied to clipboard.'
      );
    },
    onError: (e: Error) => Alert.alert('Error', e.message || 'Could not generate code'),
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Create user directly</Text>
      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        value={email}
        onChangeText={setEmail}
        placeholder="user@company.com"
        placeholderTextColor="#897c98"
      />
      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        placeholder="Minimum 8 characters"
        placeholderTextColor="#897c98"
      />
      <Text style={styles.label}>First name</Text>
      <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} />
      <Text style={styles.label}>Last name</Text>
      <TextInput style={styles.input} value={lastName} onChangeText={setLastName} />
      <Text style={styles.label}>Profile photo (optional)</Text>
      <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto}>
        <Text style={styles.photoBtnText}>{photoUri ? 'Change photo' : 'Choose photo'}</Text>
      </TouchableOpacity>
      {photoUri ? <Image source={{ uri: photoUri }} style={styles.preview} /> : null}
      <Text style={styles.label}>Role</Text>
      <View style={styles.roleRow}>
        {ROLES.map((r) => (
          <TouchableOpacity
            key={r}
            style={[styles.roleChip, role === r && styles.roleChipActive]}
            onPress={() => setRole(r)}
          >
            <Text style={[styles.roleText, role === r && styles.roleTextActive]}>{r}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {user?.role === 'superadmin' ? (
        <>
          <Text style={styles.label}>Company</Text>
          <View style={styles.roleRow}>
            {companies.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.roleChip, companyId === c.id && styles.roleChipActive]}
                onPress={() => setCompanyId(c.id)}
              >
                <Text style={[styles.roleText, companyId === c.id && styles.roleTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : null}
      <TouchableOpacity
        style={[styles.saveBtn, mutation.isPending && styles.saveDisabled]}
        disabled={mutation.isPending}
        onPress={() => mutation.mutate()}
      >
        {mutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveText}>Create user</Text>
        )}
      </TouchableOpacity>

      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>Create sign-up code</Text>
      <Text style={styles.label}>User email</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="off"
        textContentType="none"
        value={inviteEmail}
        onChangeText={setInviteEmail}
        placeholder="user@company.com"
        placeholderTextColor="#897c98"
      />
      <Text style={styles.label}>Role for code</Text>
      <View style={styles.roleRow}>
        {ROLES.map((r) => (
          <TouchableOpacity
            key={`invite-${r}`}
            style={[styles.roleChip, inviteRole === r && styles.roleChipActive]}
            onPress={() => setInviteRole(r)}
          >
            <Text style={[styles.roleText, inviteRole === r && styles.roleTextActive]}>{r}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {user?.role === 'superadmin' ? (
        <>
          <Text style={styles.label}>Company for code</Text>
          <View style={styles.roleRow}>
            {companies.map((c) => (
              <TouchableOpacity
                key={`invite-company-${c.id}`}
                style={[styles.roleChip, inviteCompanyId === c.id && styles.roleChipActive]}
                onPress={() => setInviteCompanyId(c.id)}
              >
                <Text style={[styles.roleText, inviteCompanyId === c.id && styles.roleTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : null}
      <TouchableOpacity
        style={[styles.secondaryBtn, inviteMutation.isPending && styles.saveDisabled]}
        onPress={() => inviteMutation.mutate()}
        disabled={inviteMutation.isPending}
      >
        {inviteMutation.isPending ? (
          <ActivityIndicator color="#4a026f" />
        ) : (
          <Text style={styles.secondaryText}>Generate code</Text>
        )}
      </TouchableOpacity>
      {generatedCode ? (
        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>Invitation code</Text>
          <Text style={styles.codeValue}>{generatedCode}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#4a026f', marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', color: '#4a026f', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    backgroundColor: '#fff',
  },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  photoBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#4a026f',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  photoBtnText: { color: '#4a026f', fontWeight: '600' },
  preview: { width: 96, height: 96, borderRadius: 48, marginBottom: 16 },
  roleChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
  },
  roleChipActive: { borderColor: '#4a026f', backgroundColor: '#f0e6f5' },
  roleText: { color: '#707173', textTransform: 'capitalize' },
  roleTextActive: { color: '#4a026f', fontWeight: '600' },
  saveBtn: {
    backgroundColor: '#4a026f',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveDisabled: { opacity: 0.7 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#ddd', marginVertical: 24 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#4a026f',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#fff',
  },
  secondaryText: { color: '#4a026f', fontWeight: '700' },
  codeBox: {
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8c8e7',
    backgroundColor: '#fff',
    padding: 12,
  },
  codeLabel: { color: '#707173', marginBottom: 4 },
  codeValue: { color: '#4a026f', fontSize: 16, fontWeight: '700' },
});
