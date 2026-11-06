import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import {
  xeroService,
  type XeroAuditEntry,
  type XeroContactOption,
  type XeroProjectOption,
  type XeroStatusResponse,
  type XeroUserOption,
} from '@sitesync/shared';

function apiErrorMessage(err: unknown): string {
  const ax = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
  const d = ax.response?.data;
  return d?.message || d?.error || ax.message || 'Request failed';
}

type Props = {
  companyId: string;
  status: XeroStatusResponse | null;
  onChanged: () => void;
};

export function XeroSyncPanel({ companyId, status, onChanged }: Props) {
  const connected = status?.status === 'connected' && status.xero_connected === true;
  const connectedStatus = connected && status?.status === 'connected' ? status : null;
  const [busy, setBusy] = useState<string | null>(null);
  const [projects, setProjects] = useState<XeroProjectOption[] | null>(null);
  const [contacts, setContacts] = useState<XeroContactOption[] | null>(null);
  const [users, setUsers] = useState<XeroUserOption[] | null>(null);
  const [audit, setAudit] = useState<XeroAuditEntry[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<string>) => {
    setBusy(key);
    setNote(null);
    try {
      setNote(await action());
      onChanged();
    } catch (e) {
      Alert.alert('Xero', apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const counts = status?.time_sync;

  return (
    <View style={styles.block}>
      <Text style={styles.label}>Sync</Text>
      {connectedStatus?.last_synced_at ? (
        <Text style={styles.muted}>Last sync {new Date(connectedStatus.last_synced_at).toLocaleString()}</Text>
      ) : (
        <Text style={styles.muted}>No sync yet.</Text>
      )}
      {status?.last_time_push_at ? (
        <Text style={styles.muted}>Last time push {new Date(status.last_time_push_at).toLocaleString()}</Text>
      ) : null}
      {connectedStatus?.last_refreshed_at ? (
        <Text style={styles.muted}>Token refreshed {new Date(connectedStatus.last_refreshed_at).toLocaleString()}</Text>
      ) : null}
      {counts ? (
        <Text style={styles.muted}>
          Time entries: {counts.synced} synced, {counts.failed} failed, {counts.skipped} skipped, {counts.pending}{' '}
          pending
        </Text>
      ) : null}
      {status?.projects_scope === false && connected ? (
        <Text style={styles.warn}>
          This connection does not include the Xero projects scope. Disconnect and connect again so approved time can
          be pushed.
        </Text>
      ) : null}
      {status?.last_sync_error ? <Text style={styles.error}>Last error: {status.last_sync_error}</Text> : null}
      {status?.recent_errors && status.recent_errors.length > 0 ? (
        <View style={styles.errorBox}>
          {status.recent_errors.slice(0, 5).map((row) => (
            <Text key={row.time_entry_id} style={styles.errorLine}>
              {row.error}
            </Text>
          ))}
        </View>
      ) : null}
      {status?.default_xero_user_name ? (
        <Text style={styles.muted}>Default Xero user: {status.default_xero_user_name}</Text>
      ) : (
        <Text style={styles.muted}>
          No default Xero user. Staff whose email is not a Xero user will fail to sync until you pick one below.
        </Text>
      )}

      <View style={styles.actions}>
        <Action
          label="Push approved time"
          busy={busy === 'push'}
          disabled={!connected || busy !== null}
          onPress={() =>
            run('push', async () => {
              const out = await xeroService.pushTime(companyId);
              const synced = out.results.filter((row) => row.status === 'synced').length;
              const failed = out.results.filter((row) => row.status === 'failed').length;
              const skipped = out.results.filter((row) => row.status === 'skipped').length;
              return `Pushed ${synced}, failed ${failed}, skipped ${skipped}${out.truncated ? ' (more remain — push again)' : ''}.`;
            })
          }
        />
        <Action
          label="Link projects by job number"
          busy={busy === 'match'}
          disabled={!connected || busy !== null}
          onPress={() =>
            run('match', async () => {
              const out = await xeroService.matchAllProjects(companyId);
              return `Linked ${out.linked.length}. Ambiguous ${out.ambiguous.length}. Unmatched ${out.unmatched.length}.`;
            })
          }
        />
        <Action
          label="Pull Xero projects"
          busy={busy === 'projects'}
          disabled={!connected || busy !== null}
          onPress={() =>
            run('projects', async () => {
              const out = await xeroService.listProjects(companyId);
              setProjects(out.projects);
              return `Pulled ${out.projects.length} in-progress Xero projects.`;
            })
          }
        />
        <Action
          label="Pull Xero contacts"
          busy={busy === 'contacts'}
          disabled={!connected || busy !== null}
          onPress={() =>
            run('contacts', async () => {
              const out = await xeroService.listContacts(companyId);
              setContacts(out.contacts);
              return `Pulled ${out.contacts.length} active contacts.`;
            })
          }
        />
        <Action
          label="Load Xero users"
          busy={busy === 'users'}
          disabled={!connected || busy !== null}
          onPress={() =>
            run('users', async () => {
              const out = await xeroService.listUsers(companyId);
              setUsers(out.users);
              return `Found ${out.users.length} Xero users.`;
            })
          }
        />
        <Action
          label="Show audit log"
          busy={busy === 'audit'}
          disabled={busy !== null}
          onPress={() =>
            run('audit', async () => {
              const out = await xeroService.listAudit(companyId);
              setAudit(out.logs);
              return `${out.logs.length} recent audit rows.`;
            })
          }
        />
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}

      {users && users.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.label}>Default user for unmatched staff</Text>
          {users.map((user) => (
            <TouchableOpacity
              key={user.user_id}
              style={[styles.row, status?.default_xero_user_id === user.user_id && styles.rowOn]}
              disabled={busy !== null}
              onPress={() =>
                run('default-user', async () => {
                  await xeroService.setDefaultUser(companyId, user.user_id);
                  return `Default Xero user set to ${user.name || user.email || user.user_id}.`;
                })
              }
            >
              <Text style={styles.rowTitle}>{user.name || user.email}</Text>
              {user.email ? <Text style={styles.muted}>{user.email}</Text> : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {projects && projects.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.label}>Xero projects</Text>
          {projects.slice(0, 12).map((project) => (
            <Text key={project.project_id} style={styles.rowTitle}>
              {project.job_code ? `${project.job_code} · ` : ''}
              {project.name}
            </Text>
          ))}
          {projects.length > 12 ? <Text style={styles.muted}>+ {projects.length - 12} more</Text> : null}
        </View>
      ) : null}

      {contacts && contacts.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.label}>Xero contacts</Text>
          {contacts.slice(0, 12).map((contact) => (
            <Text key={contact.contact_id} style={styles.rowTitle}>
              {contact.name}
              {contact.email ? ` · ${contact.email}` : ''}
            </Text>
          ))}
          {contacts.length > 12 ? <Text style={styles.muted}>+ {contacts.length - 12} more</Text> : null}
        </View>
      ) : null}

      {audit && audit.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.label}>Audit</Text>
          {audit.slice(0, 15).map((row) => (
            <Text key={row.id} style={styles.auditLine}>
              {new Date(row.created_at).toLocaleString()} · {row.action}
              {row.detail ? ` · ${row.detail}` : ''}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Action({
  label,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <TouchableOpacity style={[styles.secondaryBtn, disabled && styles.btnDisabled]} onPress={onPress} disabled={disabled}>
      {busy ? <ActivityIndicator color="#4a026f" /> : <Text style={styles.secondaryBtnText}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 8, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', color: '#4a026f', marginBottom: 8 },
  muted: { fontSize: 13, color: '#707173', marginBottom: 4 },
  warn: { color: '#b45309', marginVertical: 8, lineHeight: 18 },
  error: { color: '#b71c1c', marginTop: 8 },
  errorBox: { backgroundColor: '#fff', borderRadius: 8, padding: 10, marginTop: 8 },
  errorLine: { color: '#7f1d1d', fontSize: 12, marginBottom: 4 },
  actions: { gap: 8, marginTop: 12 },
  secondaryBtn: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4a026f',
  },
  secondaryBtnText: { color: '#4a026f', fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  note: { marginTop: 10, color: '#1f2937' },
  list: { marginTop: 16 },
  row: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  rowOn: { borderColor: '#4a026f', backgroundColor: '#f3e8ff' },
  rowTitle: { fontSize: 14, color: '#222', marginBottom: 4 },
  auditLine: { fontSize: 12, color: '#444', marginBottom: 6 },
});
