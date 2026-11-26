import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  companyInvitationsService,
  uploadsService,
  usersService,
  useAuthContext,
} from '@sitesync/shared';
import type { StaffAuthStackParamList } from '../../navigation/authTypes';

type Nav = NativeStackNavigationProp<StaffAuthStackParamList>;
const normalizeToken = (raw: string) => raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

/** Manual code registration: invitation role preserved; photo uploaded after account creation. */
export function StaffRegisterScreen() {
  const navigation = useNavigation<Nav>();
  const [tokenInput, setTokenInput] = useState('');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { registerInvitation, refreshUser } = useAuthContext();

  const validateToken = async () => {
    const t = normalizeToken(tokenInput);
    if (!t) {
      Alert.alert('Error', 'Enter invitation code');
      return;
    }
    setLoadingToken(true);
    setInviteEmail(null);
    try {
      const inv = await companyInvitationsService.getByToken(t);
      setInviteEmail(inv.email);
      if (!email.trim()) setEmail(inv.email);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid invitation';
      Alert.alert('Invitation', msg);
    } finally {
      setLoadingToken(false);
    }
  };

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

  const submit = async () => {
    const token = normalizeToken(tokenInput);
    if (!token || !firstName.trim() || !lastName.trim() || !password.trim()) {
      Alert.alert('Error', 'Fill in code, name and password');
      return;
    }
    if (!email.trim()) {
      Alert.alert('Error', 'Email is required');
      return;
    }
    if (!photoUri) {
      Alert.alert('Error', 'Profile photo is required');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        token,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        password: password.trim(),
        email: email.trim().toLowerCase(),
        role_mapping: 'strict' as const,
      };
      console.log('Submitting registration with payload:', payload);
      const res = await registerInvitation(payload);
      const url = await uploadsService.uploadProfilePhoto({
        uri: photoUri,
        name: 'profile.jpg',
        type: 'image/jpeg',
      });
      await usersService.update(res.user.id, { photo_url: url });
      await refreshUser();
      Alert.alert('Welcome', 'Your account is ready.');
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('Registration error:', errorMsg, e);
      Alert.alert('Error', errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create staff account</Text>
        <Text style={styles.label}>Invitation code</Text>
        <TextInput
          style={styles.input}
          value={tokenInput}
          onChangeText={setTokenInput}
          autoCapitalize="characters"
          placeholder="Code from your organisation"
          placeholderTextColor="#897c98"
        />
        <TouchableOpacity style={styles.secondaryBtn} onPress={validateToken} disabled={loadingToken}>
          {loadingToken ? (
            <ActivityIndicator color="#4a026f" />
          ) : (
            <Text style={styles.secondaryText}>Validate code</Text>
          )}
        </TouchableOpacity>
        {inviteEmail ? (
          <Text style={styles.emailHint}>Invitation email: {inviteEmail}</Text>
        ) : null}

        <Text style={styles.label}>Your email (must match invitation)</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="name@company.com"
          placeholderTextColor="#897c98"
        />
        <Text style={styles.label}>First name</Text>
        <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} />
        <Text style={styles.label}>Last name</Text>
        <TextInput style={styles.input} value={lastName} onChangeText={setLastName} />
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <Text style={styles.label}>Profile photo</Text>
        <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto}>
          <Text style={styles.photoBtnText}>{photoUri ? 'Change photo' : 'Choose photo'}</Text>
        </TouchableOpacity>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.preview} />
        ) : null}

        <TouchableOpacity
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={submit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Create account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.back} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.backText}>Back to sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 48, backgroundColor: '#f5f5f5', flexGrow: 1 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#4a026f', marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#4a026f', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  emailHint: { fontSize: 13, color: '#707173', marginBottom: 12 },
  secondaryBtn: { alignSelf: 'flex-start', marginBottom: 16 },
  secondaryText: { color: '#4a026f', fontWeight: '600' },
  photoBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4a026f',
    marginBottom: 12,
  },
  photoBtnText: { color: '#4a026f', fontWeight: '600' },
  preview: { width: 120, height: 120, borderRadius: 60, marginBottom: 16 },
  button: {
    backgroundColor: '#4a026f',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  back: { marginTop: 20, alignItems: 'center' },
  backText: { color: '#4a026f', fontWeight: '600' },
});
