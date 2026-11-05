import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import {
  useAuthContext,
  useCompanyContext,
  hasCapability,
  getStoredActiveProjectId,
  setStoredActiveProjectId,
} from '@sitesync/shared';
import type { Capability } from '@sitesync/shared';
import {
  usersService,
  projectsService,
  timesheetsService,
  jobCompletionsService,
} from '@sitesync/shared';
import type { DashboardStackParamList } from '../../navigation/DashboardStack';

type Nav = NativeStackNavigationProp<DashboardStackParamList, 'DashboardHome'>;

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function DashboardScreen() {
  const { user } = useAuthContext();
  const { activeCompany } = useCompanyContext();
  const navigation = useNavigation<Nav>();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersService.getAll(),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsService.getAll(),
  });
  const { data: timesheets = [] } = useQuery({
    queryKey: ['timesheets'],
    queryFn: () => timesheetsService.getAll(),
  });
  const { data: jobs = [] } = useQuery({
    queryKey: ['job-completions'],
    queryFn: () => jobCompletionsService.getAll(),
  });
  const visibleUsers = useMemo(() => users.filter((u) => u.role !== 'superadmin'), [users]);

  const isSupervisor = user?.role === 'supervisor';
  const supervisorProjects = useMemo(() => {
    if (!isSupervisor || !user?.id) return [];
    return projects.filter((p) => p.supervisor_id === user.id);
  }, [isSupervisor, user?.id, projects]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isSupervisor) {
      setActiveProjectId(null);
      void setStoredActiveProjectId(null);
      return;
    }
    if (supervisorProjects.length === 0) {
      setActiveProjectId(null);
      return;
    }
    void (async () => {
      const stored = await getStoredActiveProjectId();
      const valid = stored && supervisorProjects.some((p) => p.id === stored) ? stored : supervisorProjects[0].id;
      setActiveProjectId((prev) => (prev === valid ? prev : valid));
      await setStoredActiveProjectId(valid);
    })();
  }, [isSupervisor, supervisorProjects]);

  const selectedProject = useMemo(() => {
    if (!isSupervisor) return null;
    return supervisorProjects.find((p) => p.id === activeProjectId) ?? null;
  }, [isSupervisor, supervisorProjects, activeProjectId]);

  const scopedTimesheets = useMemo(() => {
    if (!isSupervisor || !selectedProject) return timesheets;
    return timesheets.filter((t) => t.project_id === selectedProject.id);
  }, [isSupervisor, selectedProject, timesheets]);
  const scopedJobs = useMemo(() => {
    if (!isSupervisor || !selectedProject) return jobs;
    return jobs.filter((j) => j.project_id === selectedProject.id);
  }, [isSupervisor, selectedProject, jobs]);
  const scopedUsersCount = useMemo(() => {
    if (!isSupervisor || !selectedProject) return visibleUsers.length;
    const ids = new Set<string>();
    if (selectedProject.supervisor_id) ids.add(selectedProject.supervisor_id);
    if (selectedProject.assigned_staff_id) ids.add(selectedProject.assigned_staff_id);
    scopedTimesheets.forEach((t) => ids.add(t.user_id));
    return visibleUsers.filter((u) => ids.has(u.id)).length;
  }, [isSupervisor, selectedProject, scopedTimesheets, visibleUsers]);

  const openShifts = scopedTimesheets.filter((t) => !t.sign_out_at).length;
  const pendingJobs = scopedJobs.filter((j) => j.status === 'pending').length;

  const liveJobs = useMemo(
    () => projects.filter((p) => !p.completed && !p.archived && p.can_be_active),
    [projects]
  );

  const allMenu: {
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
    route: keyof DashboardStackParamList | 'VehiclesTab';
    need?: Capability;
  }[] = [
    { title: 'Vehicles', subtitle: 'Fleet, allocations and checks', icon: 'car-outline', route: 'VehiclesTab' },
    { title: 'Governance', subtitle: 'Global platform overview', icon: 'globe-outline', route: 'Governance', need: 'cross_company' },
    { title: 'Users', subtitle: 'Team & roles', icon: 'people-outline', route: 'Users', need: 'manage_users' },
    { title: 'Projects', subtitle: 'Sites & jobs', icon: 'business-outline', route: 'Projects', need: 'manage_projects' },
    { title: 'Timesheets', subtitle: 'Attendance & hours', icon: 'time-outline', route: 'Timesheets' },
    { title: 'Job completions', subtitle: 'Approve work', icon: 'checkmark-done-outline', route: 'Jobs' },
    { title: 'Reports', subtitle: 'Attendance summaries', icon: 'bar-chart-outline', route: 'Reports', need: 'view_reports' },
    { title: 'Invoices', subtitle: 'Xero sales invoices', icon: 'receipt-outline', route: 'Invoices', need: 'manage_invoices' },
    { title: 'Incident reports', subtitle: 'Track and resolve incidents', icon: 'warning-outline', route: 'Incidents' },
  ];

  const menuItems = allMenu.filter((item) => {
    if (!item.need) return true;
    return hasCapability(user?.role, item.need);
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.welcome}>Welcome, {user?.first_name || 'Admin'}</Text>
      <Text style={styles.nowInline}>Current time: {now.toLocaleTimeString()}</Text>
      <Text style={styles.subtitle}>
        {isSupervisor
          ? selectedProject
            ? `Project view: ${selectedProject.name}`
            : 'Select a project to view project-specific dashboard data'
          : activeCompany
            ? `Overview for ${activeCompany.name}`
            : 'Overview for your organisation'}
      </Text>
      {isSupervisor ? (
        <View style={styles.scopeCard}>
          <Text style={styles.scopeTitle}>Current project</Text>
          <View style={styles.scopeChips}>
            {supervisorProjects.map((p) => {
              const active = p.id === selectedProject?.id;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.scopeChip, active && styles.scopeChipOn]}
                  onPress={() => {
                    setActiveProjectId(p.id);
                    void setStoredActiveProjectId(p.id);
                  }}
                >
                  <Text style={[styles.scopeChipText, active && styles.scopeChipTextOn]}>{p.name}</Text>
                </Pressable>
              );
            })}
            {supervisorProjects.length === 0 ? (
              <Text style={styles.scopeEmpty}>No assigned projects yet.</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={styles.grid}>
        <StatCard label="Users" value={scopedUsersCount} />
        <StatCard label="Projects" value={isSupervisor ? supervisorProjects.length : projects.length} />
        <StatCard label="Open shifts" value={openShifts} />
        <StatCard label="Jobs pending" value={pendingJobs} />
      </View>

      <Text style={styles.sectionTitle}>Live Jobs</Text>
      {liveJobs.length === 0 ? (
        <Text style={styles.liveJobsEmpty}>No active jobs at the moment.</Text>
      ) : (
        <View style={styles.liveJobsList}>
          {liveJobs.map((p) => {
            const onSite = timesheets.filter((t) => t.project_id === p.id && !t.sign_out_at).length;
            return (
              <Pressable
                key={p.id}
                style={({ pressed }) => [styles.liveJobCard, pressed && styles.liveJobCardPressed]}
                onPress={() => navigation.navigate('Projects')}
              >
                <View style={styles.liveJobRow}>
                  <Ionicons name="construct-outline" size={18} color="#4a026f" style={styles.liveJobIcon} />
                  <Text style={styles.liveJobName} numberOfLines={1}>{p.name}</Text>
                  <View style={styles.liveJobBadge}>
                    <Ionicons name="person-outline" size={11} color="#fff" />
                    <Text style={styles.liveJobBadgeText}>{onSite} on site</Text>
                  </View>
                </View>
                {p.address ? (
                  <View style={styles.liveJobAddressRow}>
                    <Ionicons name="location-outline" size={12} color="#8a7a9b" />
                    <Text style={styles.liveJobAddress} numberOfLines={1}>{p.address}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}

      <Text style={styles.sectionTitle}>Quick access</Text>
      <View style={styles.quickGrid}>
        {menuItems.map((item) => (
          <Pressable
            key={item.route}
            style={({ pressed }) => [styles.quickCardOuter, pressed && styles.quickCardPressed]}
            onPress={() => {
              if (item.route === 'VehiclesTab') {
                navigation.dispatch(CommonActions.navigate({ name: 'Vehicles' }));
                return;
              }
              navigation.navigate(item.route);
            }}
          >
            <LinearGradient
              colors={['#e8ddfa', '#d4c4ec', '#c5b0e0']}
              locations={[0, 0.45, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.quickCardGradient}
            >
              <LinearGradient
                colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.08)', 'transparent']}
                locations={[0, 0.35, 1]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 0.55 }}
                style={StyleSheet.absoluteFillObject}
                pointerEvents="none"
              />
              <View style={styles.quickIconOrb}>
                <Ionicons name={item.icon} size={28} color="#4a026f" />
              </View>
              <Text style={styles.quickCardTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.quickCardSubtitle} numberOfLines={3}>
                {item.subtitle}
              </Text>
            </LinearGradient>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 20, paddingBottom: 40 },
  welcome: { fontSize: 24, fontWeight: 'bold', color: '#4a026f', marginBottom: 4 },
  nowInline: { fontSize: 12, color: '#8a8096', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#707173', marginBottom: 16 },
  scopeCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    padding: 12,
    marginBottom: 16,
  },
  scopeTitle: { fontSize: 13, fontWeight: '700', color: '#4a026f', marginBottom: 8 },
  scopeChips: { flexDirection: 'row', flexWrap: 'wrap' },
  scopeChip: {
    borderWidth: 1,
    borderColor: '#c6b4d3',
    borderRadius: 16,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  scopeChipOn: { borderColor: '#4a026f', backgroundColor: '#ede7f6' },
  scopeChipText: { color: '#5e4f6c', fontSize: 12, fontWeight: '600' },
  scopeChipTextOn: { color: '#4a026f' },
  scopeEmpty: { color: '#707173', fontSize: 13 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 24,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 640,
  },
  statCard: {
    width: '46%',
    marginBottom: 12,
    marginHorizontal: 6,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  statValue: { fontSize: 28, fontWeight: 'bold', color: '#4a026f', textAlign: 'center' },
  statLabel: { fontSize: 13, color: '#707173', marginTop: 4, textAlign: 'center' },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#4a026f',
    marginBottom: 12,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  quickCardOuter: {
    width: '48%',
    marginBottom: 12,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.65)',
    ...Platform.select({
      web: { boxShadow: '0 6px 16px rgba(74, 2, 111, 0.18)' } as object,
      default: {
        shadowColor: '#4a026f',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 10,
        elevation: 6,
      },
    }),
  },
  quickCardPressed: { opacity: 0.92, transform: [{ scale: 0.98 }] },
  quickCardGradient: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 14,
    minHeight: 148,
    alignItems: 'center',
  },
  quickIconOrb: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  quickCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3d0a5c',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 4,
  },
  quickCardSubtitle: {
    fontSize: 11,
    color: '#5c4a6e',
    textAlign: 'center',
    lineHeight: 15,
  },
  liveJobsEmpty: {
    color: '#8a8096',
    fontSize: 13,
    marginBottom: 24,
  },
  liveJobsList: {
    marginBottom: 24,
  },
  liveJobCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8e0f0',
    padding: 12,
    marginBottom: 8,
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(74, 2, 111, 0.08)' } as object,
      default: {
        shadowColor: '#4a026f',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 2,
      },
    }),
  },
  liveJobCardPressed: { opacity: 0.85 },
  liveJobRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveJobIcon: { marginRight: 8 },
  liveJobName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#3d0a5c',
  },
  liveJobBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4a026f',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 3,
  },
  liveJobBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  liveJobAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
    gap: 3,
  },
  liveJobAddress: {
    fontSize: 12,
    color: '#8a7a9b',
    flex: 1,
  },
});
