import React, { useEffect, useState } from 'react';
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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  companyInvitationsService,
  uploadsService,
  usersService,
  useAuthContext,
} from '@sitesync/shared';
import type { AdminAuthStackParamList } from '../../navigation/authTypes';

type Props = NativeStackScreenProps<AdminAuthStackParamList, 'InvitationRegister'>;
const normalizeToken = (raw: string) => raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

export function InvitationRegisterScreen({ route, navigation }: Props) {
  const requestMode = route.params?.mode === 'request';
  const [tokenInput, setTokenInput] = useState(route.params?.token ?? '');
  const [requestEmail, setRequestEmail] = useState('');
  const [requestingCode, setRequestingCode] = useState(false);
  const [requestStatus, setRequestStatus] = useState<string | null>(null);
  const [showSignup, setShowSignup] = useState(!requestMode);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [loadingToken, setLoadingToken] = useState(false);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { registerInvitation, logout, refreshUser } = useAuthContext();

  useEffect(() => {
    const t = route.params?.token?.trim();
    if (!t) return;
    setTokenInput(t);
    void loadInvitation(t);
  }, [route.params?.token]);

  const loadInvitation = async (raw: string) => {
    const t = normalizeToken(raw);
    if (!t) return;
    setLoadingToken(true);
    setInviteEmail(null);
    try {
      const inv = await companyInvitationsService.getByToken(t);
      setInviteEmail(inv.email);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid invitation';
      Alert.alert('Invitation', msg);
    } finally {
      setLoadingToken(false);
    }
  };

  const requestCode = async () => {
    const email = requestEmail.trim().toLowerCase();
    if (!email) {
      Alert.alert('Request code', 'Enter your email first.');
      return;
    }
    setRequestingCode(true);
    setRequestStatus(null);
    try {
      const res = await companyInvitationsService.requestCode(email);
      setRequestStatus(res.message);
      Alert.alert('Request sent', res.message);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not request code';
      setRequestStatus(String(msg));
      Alert.alert('Request code', String(msg));
    } finally {
      setRequestingCode(false);
    }
  };

  const submit = async () => {
    const token = normalizeToken(tokenInput);
    if (!token || !firstName.trim() || !lastName.trim() || !password.trim()) {
      Alert.alert('Error', 'Fill in invitation code, name and password');
      return;
    }
    setSubmitting(true);
    try {
      const res = await registerInvitation({
        token,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        password: password.trim(),
        role_mapping: 'invite_link',
      });
      if (photoUri) {
        const photoUrl = await uploadsService.uploadProfilePhoto({
          uri: photoUri,
          name: 'profile.jpg',
          type: 'image/jpeg',
        });
        await usersService.update(res.user.id, { photo_url: photoUrl });
      }
      await refreshUser();
      await logout();
      Alert.alert('Account created', 'Sign in with your email and password.', [
        { text: 'OK', onPress: () => navigation.navigate('Login') },
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Registration failed';
      Alert.alert('Error', String(msg));
    } finally {
      setSubmitting(false);
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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Complete invitation</Text>
        <Text style={styles.label}>Request invitation code</Text>
        <TextInput
          style={styles.input}
          value={requestEmail}
          onChangeText={setRequestEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="name@company.com"
          placeholderTextColor="#897c98"
        />
        <TouchableOpacity style={styles.secondaryBtn} onPress={requestCode} disabled={requestingCode}>
          {requestingCode ? (
            <ActivityIndicator color="#4a026f" />
          ) : (
            <Text style={styles.secondaryText}>Request code by email</Text>
          )}
        </TouchableOpacity>
        {requestStatus ? <Text style={styles.statusText}>{requestStatus}</Text> : null}

        {!showSignup ? (
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setShowSignup(true)}>
            <Text style={styles.secondaryText}>I have a code - continue signup</Text>
          </TouchableOpacity>
        ) : null}

        {showSignup ? (
          <>
        <Text style={styles.label}>Invitation code</Text>
        <TextInput
          style={styles.input}
          value={tokenInput}
          onChangeText={setTokenInput}
          autoCapitalize="characters"
          placeholder="Paste code from email"
          placeholderTextColor="#897c98"
        />
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => loadInvitation(tokenInput)}
          disabled={loadingToken}
        >
          {loadingToken ? (
            <ActivityIndicator color="#4a026f" />
          ) : (
            <Text style={styles.secondaryText}>Validate code</Text>
          )}
        </TouchableOpacity>

        {inviteEmail ? (
          <Text style={styles.emailHint}>Email on file: {inviteEmail}</Text>
        ) : null}

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
        <Text style={styles.label}>Profile photo (optional)</Text>
        <TouchableOpacity style={styles.secondaryBtn} onPress={pickPhoto}>
          <Text style={styles.secondaryText}>{photoUri ? 'Change photo' : 'Choose photo'}</Text>
        </TouchableOpacity>
        {photoUri ? <Image source={{ uri: photoUri }} style={styles.preview} /> : null}

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

        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
          <Text style={styles.link}>Back to sign in</Text>
        </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity onPress={() => navigation.navigate('Login')}>
            <Text style={styles.link}>Back to sign in</Text>
          </TouchableOpacity>
        )}
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
  statusText: { fontSize: 13, color: '#4a026f', marginBottom: 12 },
  preview: { width: 100, height: 100, borderRadius: 50, marginBottom: 16 },
  button: {
    backgroundColor: '#4a026f',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { textAlign: 'center', marginTop: 20, color: '#4a026f', fontWeight: '600' },
});
