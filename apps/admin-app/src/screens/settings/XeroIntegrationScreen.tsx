import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  Linking,
  RefreshControl,
  Platform,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useFocusEffect } from '@react-navigation/native';
import {
  useAuthContext,
  xeroService,
  companiesService,
  type XeroStatusResponse,
  type Company,
  type XeroTenantOption,
} from '@sitesync/shared';
import { XeroSyncPanel } from './XeroSyncPanel';

const XERO_REDIRECT_URI = process.env.EXPO_PUBLIC_XERO_REDIRECT_URI?.trim() ?? '';

function apiErrorMessage(err: unknown): string {
  const ax = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
  const d = ax.response?.data;
  return d?.error || d?.message || ax.message || 'Request failed';
}

function isXeroConnected(s: XeroStatusResponse | null): s is Extract<XeroStatusResponse, { status: 'connected' }> {
  return s !== null && s.status === 'connected' && s.xero_connected === true;
}

async function pollStatus(companyId: string, attempts = 12, delayMs = 700): Promise<XeroStatusResponse> {
  let last: XeroStatusResponse | null = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    last = await xeroService.getStatus(companyId);
    if (last.status === 'connected' || last.status === 'pending_tenant' || last.status === 'reauth_required') {
      return last;
    }
  }
  return last ?? { status: 'disconnected', company_id: companyId, xero_connected: false };
}

export function XeroIntegrationScreen() {
  const { user } = useAuthContext();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [status, setStatus] = useState<XeroStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [pendingPick, setPendingPick] = useState<{
    pendingId: string;
    tenants: XeroTenantOption[];
  } | null>(null);

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!user) return;
      if (user.role === 'admin') {
        setSelectedCompanyId(user.company_id);
        return;
      }
      if (user.role === 'superadmin') {
        setCompaniesLoading(true);
        try {
          const list = await companiesService.getAll();
          if (cancelled) return;
          setCompanies(list);
          setSelectedCompanyId((prev) => prev ?? list[0]?.id ?? null);
        } catch (e) {
          Alert.alert('Could not load companies', apiErrorMessage(e));
        } finally {
          if (!cancelled) setCompaniesLoading(false);
        }
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const loadStatus = useCallback(async () => {
    if (!selectedCompanyId) {
      setStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const s = await xeroService.getStatus(selectedCompanyId);
      setStatus(s);
      if (s.status === 'pending_tenant') {
        try {
          const p = await xeroService.getPending(s.pending_id);
          setPendingPick({ pendingId: p.pending_id, tenants: p.tenants });
        } catch (e) {
          setPendingPick(null);
          Alert.alert('Organisation list', apiErrorMessage(e));
        }
      } else {
        setPendingPick(null);
      }
    } catch (e) {
      setStatus(null);
      Alert.alert('Status', apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useFocusEffect(
    useCallback(() => {
      if (isAdmin && selectedCompanyId) {
        void loadStatus();
      } else {
        setLoading(false);
      }
    }, [isAdmin, selectedCompanyId, loadStatus])
  );

  const onConnect = async () => {
    if (!selectedCompanyId) return;
    if (!XERO_REDIRECT_URI && Platform.OS !== 'web') {
      Alert.alert(
        'Missing EXPO_PUBLIC_XERO_REDIRECT_URI',
        'Add it to apps/admin-app/.env — it must match XERO_REDIRECT_URI on the server (e.g. http://YOUR-LAN-IP:3001/api/xero/oauth/callback for a phone). Restart Expo after changing .env.'
      );
      return;
    }
    setActionLoading(true);
    try {
      const { authorization_url } = await xeroService.getConnectStart(selectedCompanyId);

      if (Platform.OS === 'web') {
        await Linking.openURL(authorization_url);
        Alert.alert(
          'Complete sign-in in the browser',
          'When Xero shows success, close the tab and tap Refresh status here.'
        );
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(authorization_url, XERO_REDIRECT_URI);
      if (result.type === 'cancel' || result.type === 'dismiss') {
        return;
      }

      const s = await pollStatus(selectedCompanyId);
      setStatus(s);
      if (s.status === 'pending_tenant') {
        const p = await xeroService.getPending(s.pending_id);
        setPendingPick({ pendingId: p.pending_id, tenants: p.tenants });
      } else if (s.status === 'disconnected') {
        Alert.alert(
          'Still disconnected',
          'If you just finished Xero sign-in, wait a few seconds and tap Refresh status. On a phone, use your PC LAN IP or ngrok in EXPO_PUBLIC_API_URL and EXPO_PUBLIC_XERO_REDIRECT_URI.'
        );
      }
    } catch (e) {
      Alert.alert('Connect failed', apiErrorMessage(e));
    } finally {
      setActionLoading(false);
    }
  };

  const onPickTenant = async (tenantId: string) => {
    if (!pendingPick) return;
    setActionLoading(true);
    try {
      await xeroService.completePending(pendingPick.pendingId, tenantId);
      setPendingPick(null);
      await loadStatus();
    } catch (e) {
      Alert.alert('Could not link organisation', apiErrorMessage(e));
    } finally {
      setActionLoading(false);
    }
  };

  const onDisconnect = () => {
    if (!selectedCompanyId) return;
    Alert.alert('Disconnect Xero?', 'Your organisation link will be removed for this company.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          setActionLoading(true);
          try {
            await xeroService.disconnect(selectedCompanyId);
            setPendingPick(null);
            await loadStatus();
          } catch (e) {
            Alert.alert('Disconnect failed', apiErrorMessage(e));
          } finally {
            setActionLoading(false);
          }
        },
      },
    ]);
  };

  const statusLabel = (s: XeroStatusResponse | null) => {
    if (!s) return 'Status unavailable. Use Refresh.';
    if (isXeroConnected(s)) return `Connected — ${s.xero_tenant_name || s.xero_tenant_id}`;
    if (s.status === 'pending_tenant') return 'Choose your Xero organisation (below)';
    if (s.status === 'reauth_required') return 'Re-authorization required';
    return 'Not connected';
  };

  if (!user) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Not signed in.</Text>
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <Text style={styles.body}>Only company admins can connect or disconnect Xero.</Text>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={!!selectedCompanyId && loading}
            onRefresh={loadStatus}
            tintColor="#4a026f"
          />
        }
      >
        {user.role === 'superadmin' && companies.length > 0 && (
          <View style={styles.block}>
            <Text style={styles.label}>Company</Text>
            {companies.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.chip, selectedCompanyId === c.id && styles.chipSelected]}
                onPress={() => setSelectedCompanyId(c.id)}
              >
                <Text style={[styles.chipText, selectedCompanyId === c.id && styles.chipTextSelected]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {user.role === 'superadmin' && companies.length === 0 && !companiesLoading && (
          <Text style={styles.warn}>No companies found. Create a company first.</Text>
        )}

        {companiesLoading && user.role === 'superadmin' ? (
          <ActivityIndicator size={36} color="#4a026f" style={styles.spinner} />
        ) : user.role === 'superadmin' && companies.length === 0 ? null : !selectedCompanyId ? (
          <ActivityIndicator size={36} color="#4a026f" style={styles.spinner} />
        ) : (
          <>
            <View style={styles.block}>
              <Text style={styles.label}>Status</Text>
              {loading ? (
                <ActivityIndicator color="#4a026f" style={{ alignSelf: 'flex-start' }} />
              ) : status ? (
                <>
                  <Text style={styles.statusLine}>{statusLabel(status)}</Text>
                  {isXeroConnected(status) && status.connected_at && (
                    <Text style={styles.mutedSmall}>Connected {new Date(status.connected_at).toLocaleString()}</Text>
                  )}
                  {isXeroConnected(status) && status.xero_tenant_name ? (
                    <Text style={styles.mutedSmall}>Organisation {status.xero_tenant_name}</Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.muted}>Status unavailable. Use Refresh.</Text>
              )}
            </View>

            {status?.status === 'pending_tenant' && pendingPick && pendingPick.tenants.length > 0 ? (
              <View style={styles.block}>
                <Text style={styles.label}>Organisations</Text>
                {pendingPick.tenants.map((t) => (
                  <TouchableOpacity
                    key={t.tenantId}
                    style={styles.orgRow}
                    onPress={() => onPickTenant(t.tenantId)}
                    disabled={actionLoading}
                  >
                    <Text style={styles.orgName}>{t.tenantName}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.primaryBtn, actionLoading && styles.btnDisabled]}
                onPress={onConnect}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Connect to Xero</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryBtn, actionLoading && styles.btnDisabled]}
                onPress={onDisconnect}
                disabled={actionLoading || !isXeroConnected(status)}
              >
                <Text style={styles.secondaryBtnText}>Disconnect</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.secondaryBtn} onPress={loadStatus} disabled={actionLoading}>
                <Text style={styles.secondaryBtnText}>Refresh status</Text>
              </TouchableOpacity>
            </View>

            {selectedCompanyId ? (
              <XeroSyncPanel companyId={selectedCompanyId} status={status} onChanged={() => void loadStatus()} />
            ) : null}

            <Text style={styles.hint}>
              {Platform.OS === 'web'
                ? 'Sign-in opens in a new tab. Use the same API base URL your backend uses for OAuth.'
                : 'Sign-in uses an in-app browser and returns here automatically. EXPO_PUBLIC_XERO_REDIRECT_URI must match server XERO_REDIRECT_URI. On a real device, use your computer IP or ngrok, not localhost.'}{' '}
              No Xero tokens are stored on this device.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 24, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  block: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#4a026f', marginBottom: 8 },
  body: { fontSize: 16, color: '#333' },
  muted: { color: '#707173' },
  mutedSmall: { fontSize: 12, color: '#897c98', marginTop: 4 },
  warn: { color: '#b45309', marginBottom: 12 },
  statusLine: { fontSize: 16, color: '#222' },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 8,
  },
  chipSelected: { borderColor: '#4a026f', backgroundColor: '#f3e8ff' },
  chipText: { fontSize: 15, color: '#333' },
  chipTextSelected: { fontWeight: '600', color: '#4a026f' },
  spinner: { marginVertical: 24 },
  actions: { gap: 12 },
  primaryBtn: {
    backgroundColor: '#4a026f',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryBtn: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4a026f',
  },
  secondaryBtnText: { color: '#4a026f', fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.6 },
  hint: { marginTop: 24, fontSize: 13, color: '#707173', lineHeight: 20 },
  orgRow: {
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 8,
  },
  orgName: { fontSize: 16, fontWeight: '600', color: '#333' },
});
