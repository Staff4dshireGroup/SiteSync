import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  xeroService,
  type XeroContactOption,
  type XeroProjectOption,
} from '@sitesync/shared';

function apiErrorMessage(err: unknown): string {
  const ax = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
  const d = ax.response?.data;
  return d?.message || d?.error || ax.message || 'Request failed';
}

type Props = {
  companyId: string;
  projectId: string;
};

export function XeroProjectLinkPanel({ companyId, projectId }: Props) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [xeroProjects, setXeroProjects] = useState<XeroProjectOption[] | null>(null);
  const [contacts, setContacts] = useState<XeroContactOption[] | null>(null);
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const linksQuery = useQuery({
    queryKey: ['xero', 'project-link', companyId, projectId],
    queryFn: () => xeroService.listProjectLinks(companyId, projectId),
    enabled: Boolean(companyId && projectId),
  });
  const linkView = linksQuery.data?.projects[0];

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['xero', 'project-link', companyId, projectId] });
  };

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await action());
      await refresh();
    } catch (e) {
      Alert.alert('Xero project', apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const visibleProjects = (xeroProjects ?? []).filter((project) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return `${project.name} ${project.job_code ?? ''}`.toLowerCase().includes(q);
  });

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Xero project</Text>
      {linksQuery.isLoading ? <ActivityIndicator color="#4a026f" /> : null}
      {linkView?.link ? (
        <>
          <Text style={styles.body}>
            Linked ({linkView.link.method}): {linkView.link.xero_project_name}
          </Text>
          <Text style={styles.muted}>Linked {new Date(linkView.link.linked_at).toLocaleString()}</Text>
          <TouchableOpacity
            style={styles.secondary}
            disabled={busy}
            onPress={() =>
              run(async () => {
                await xeroService.unlinkProject(companyId, projectId);
                return 'Unlinked. Time already sent to Xero is left in place.';
              })
            }
          >
            <Text style={styles.secondaryText}>Unlink</Text>
          </TouchableOpacity>
        </>
      ) : linkView ? (
        <Text style={styles.body}>Not linked. Job code: {linkView.job_code ?? 'none found in the name or address'}.</Text>
      ) : null}
      {linkView?.suggested_name ? (
        <Text style={styles.muted}>New Xero name would be “{linkView.suggested_name}”.</Text>
      ) : null}

      <TouchableOpacity
        style={styles.primary}
        disabled={busy}
        onPress={() =>
          run(async () => {
            const out = await xeroService.matchProject(companyId, projectId, true);
            if (out.linked) return `Linked by job number ${out.job_code}.`;
            if (!out.job_code) return 'No Sp/Sc/Sf/Sg/Is job number on this project.';
            if (out.matches.length === 0) return `No in-progress Xero project matches ${out.job_code}.`;
            setXeroProjects(out.matches);
            return `${out.matches.length} Xero projects match ${out.job_code}. Pick one.`;
          })
        }
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Match job number</Text>}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondary}
        disabled={busy}
        onPress={() =>
          run(async () => {
            const out = await xeroService.listProjects(companyId);
            setXeroProjects(out.projects);
            return `Loaded ${out.projects.length} Xero projects.`;
          })
        }
      >
        <Text style={styles.secondaryText}>Choose from Xero list</Text>
      </TouchableOpacity>

      {xeroProjects ? (
        <View>
          <TextInput
            style={styles.input}
            value={filter}
            onChangeText={setFilter}
            placeholder="Filter Xero projects"
            placeholderTextColor="#897c98"
          />
          {visibleProjects.slice(0, 20).map((project) => (
            <TouchableOpacity
              key={project.project_id}
              style={styles.choice}
              disabled={busy}
              onPress={() =>
                run(async () => {
                  await xeroService.linkProject(companyId, projectId, project.project_id);
                  return `Linked to ${project.name}.`;
                })
              }
            >
              <Text style={styles.choiceText}>{project.name}</Text>
            </TouchableOpacity>
          ))}
          {visibleProjects.length === 0 ? <Text style={styles.muted}>No projects match that filter.</Text> : null}
        </View>
      ) : null}

      <TouchableOpacity
        style={styles.secondary}
        disabled={busy}
        onPress={() =>
          run(async () => {
            const out = await xeroService.listContacts(companyId);
            setContacts(out.contacts);
            return `Loaded ${out.contacts.length} contacts. Pick one to create the Xero project.`;
          })
        }
      >
        <Text style={styles.secondaryText}>Create in Xero</Text>
      </TouchableOpacity>
      {contacts?.slice(0, 20).map((contact) => (
        <TouchableOpacity
          key={contact.contact_id}
          style={styles.choice}
          disabled={busy}
          onPress={() =>
            run(async () => {
              await xeroService.createProject(companyId, projectId, contact.contact_id);
              return `Created in Xero for ${contact.name}.`;
            })
          }
        >
          <Text style={styles.choiceText}>{contact.name}</Text>
        </TouchableOpacity>
      ))}
      {message ? <Text style={styles.note}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 20,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e7dff0',
  },
  title: { fontSize: 16, fontWeight: '700', color: '#4a026f', marginBottom: 8 },
  body: { fontSize: 14, color: '#222', marginBottom: 4 },
  muted: { fontSize: 12, color: '#707173', marginBottom: 8 },
  note: { marginTop: 8, color: '#1f2937' },
  primary: {
    backgroundColor: '#4a026f',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryText: { color: '#fff', fontWeight: '600' },
  secondary: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4a026f',
    marginTop: 8,
  },
  secondaryText: { color: '#4a026f', fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    backgroundColor: '#fff',
  },
  choice: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  choiceText: { color: '#222' },
});
