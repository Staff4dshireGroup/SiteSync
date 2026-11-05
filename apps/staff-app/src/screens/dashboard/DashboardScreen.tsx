import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import {
  useAuthContext,
  getStoredActiveProjectId,
  setStoredActiveProjectId,
  projectsService,
  jobCompletionsService,
} from '@sitesync/shared';
import { timesheetsService } from '@sitesync/shared';
import type { TimeEntry } from '@sitesync/shared';
import type { StaffDashboardStackParamList } from '../../navigation/DashboardStack';

type Nav = NativeStackNavigationProp<StaffDashboardStackParamList, 'DashboardHome'>;

export function DashboardScreen() {
  const { user } = useAuthContext();
  const navigation = useNavigation<Nav>();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());

  const isSupervisor = user?.role === 'supervisor';
  const { data: entries = [] } = useQuery({
    queryKey: ['timesheets', isSupervisor ? 'supervisor-dashboard' : user?.id],
    queryFn: () => (isSupervisor ? timesheetsService.getAll() : timesheetsService.getByUserId(user!.id)),
    enabled: !!user?.id,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsService.getAll(),
  });
  const { data: completions = [] } = useQuery({
    queryKey: ['job-completions'],
    queryFn: () => jobCompletionsService.getAll(),
    enabled: isSupervisor,
  });

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
      return;
    }
    if (supervisorProjects.length === 0) {
      setActiveProjectId(null);
      return;
    }
    void (async () => {
      const stored = await getStoredActiveProjectId();
      const valid = stored && supervisorProjects.some((p) => p.id === stored) ? stored : supervisorProjects[0].id;
      setActiveProjectId(valid);
      await setStoredActiveProjectId(valid);
    })();
  }, [isSupervisor, supervisorProjects]);

  const scopedEntries = useMemo(() => {
    if (!isSupervisor || !activeProjectId) return entries;
    return entries.filter((e) => e.project_id === activeProjectId);
  }, [entries, isSupervisor, activeProjectId]);
  const scopedCompletions = useMemo(() => {
    if (!isSupervisor || !activeProjectId) return completions;
    return completions.filter((c) => c.project_id === activeProjectId);
  }, [isSupervisor, activeProjectId, completions]);

  const openEntry = useMemo(
    () => scopedEntries.find((e: TimeEntry) => !e.sign_out_at) ?? null,
    [scopedEntries]
  );

  const thisWeek = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    return scopedEntries.filter((e) => new Date(e.sign_in_at) >= startOfWeek).length;
  }, [scopedEntries]);
  const signedInStaffNow = useMemo(() => {
    const ids = new Set(scopedEntries.filter((e) => !e.sign_out_at).map((e) => e.user_id));
    if (user?.id) ids.delete(user.id);
    return ids.size;
  }, [scopedEntries, user?.id]);
  const pendingTimesheetApprovals = useMemo(
    () => scopedEntries.filter((e) => !!e.sign_out_at && !e.approved_at).length,
    [scopedEntries]
  );
  const pendingJobApprovals = useMemo(
    () => scopedCompletions.filter((c) => c.status === 'pending').length,
    [scopedCompletions]
  );

  const menuItems: {
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
    route: Exclude<keyof StaffDashboardStackParamList, 'JobCompletionSubmit'> | 'VehicleTab';
  }[] = [
    {
      title: 'Vehicle',
      subtitle: 'My vehicle, today’s check and defects',
      icon: 'car-outline',
      route: 'VehicleTab',
    },
    {
      title: 'Sign in / out',
      subtitle: isSupervisor ? 'Optional: use only during project inspection' : 'Clock in with GPS',
      icon: 'location-outline',
      route: 'SignInOut',
    },
    {
      title: isSupervisor ? 'Review timesheets' : 'Timesheets',
      subtitle: isSupervisor ? 'Approve staff clock records' : 'Your hours',
      icon: 'calendar-outline',
      route: 'Timesheets',
    },
    {
      title: 'Toolbox Talk',
      subtitle: 'Open team discussions',
      icon: 'chatbubbles-outline',
      route: 'ToolboxTalk',
    },
    {
      title: isSupervisor ? 'Review jobs' : 'Job completions',
      subtitle: isSupervisor ? 'Approve pending submissions' : 'Submit work done',
      icon: 'construct-outline',
      route: 'Jobs',
    },
    { title: 'Incidents', subtitle: 'Report an issue', icon: 'warning-outline', route: 'Incidents' },
    { title: 'Export timesheets', subtitle: 'PDF / CSV', icon: 'download-outline', route: 'TimesheetExport' },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.welcome}>Hello, {user?.first_name || 'Staff'}</Text>
      <Text style={styles.nowInline}>Current time: {now.toLocaleTimeString()}</Text>
      <Text style={styles.subtitle}>
        {isSupervisor
          ? `Project view: ${
              supervisorProjects.find((p) => p.id === activeProjectId)?.name ?? 'No selected project'
            }`
          : 'Your workplace hub'}
      </Text>
      {!isSupervisor ? (
        <>
          <View style={styles.row}>
            <View style={[styles.stat, styles.statHalf]}>
              <Text style={styles.statNum}>{thisWeek}</Text>
              <Text style={styles.statLabel}>Clock events (week)</Text>
            </View>
            <View style={[styles.stat, styles.statHalf]}>
              <Text style={styles.statNum}>{openEntry ? '●' : '○'}</Text>
              <Text style={styles.statLabel}>{openEntry ? 'On shift' : 'Off shift'}</Text>
            </View>
          </View>

          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>Shift</Text>
            {openEntry ? (
              <Text style={styles.statusBody}>Signed in since {new Date(openEntry.sign_in_at).toLocaleString()}</Text>
            ) : (
              <Text style={styles.statusBody}>Not signed in — use Sign in / out when you arrive on site.</Text>
            )}
          </View>
        </>
      ) : (
        <View style={styles.rowWrap}>
          <View style={[styles.stat, styles.statHalf]}>
            <Text style={styles.statNum}>{openEntry ? '1' : '0'}</Text>
            <Text style={styles.statLabel}>My open shifts</Text>
          </View>
          <View style={[styles.stat, styles.statHalf]}>
            <Text style={styles.statNum}>{signedInStaffNow}</Text>
            <Text style={styles.statLabel}>Staff signed in now</Text>
          </View>
          <View style={[styles.stat, styles.statHalf]}>
            <Text style={styles.statNum}>{pendingTimesheetApprovals}</Text>
            <Text style={styles.statLabel}>Timesheets to approve</Text>
          </View>
          <View style={[styles.stat, styles.statHalf]}>
            <Text style={styles.statNum}>{pendingJobApprovals}</Text>
            <Text style={styles.statLabel}>Jobs to review</Text>
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>Quick access</Text>
      <View style={styles.quickGrid}>
        {menuItems.map((item) => (
          <Pressable
            key={item.route}
            style={({ pressed }) => [styles.quickCardOuter, pressed && styles.quickCardPressed]}
            onPress={() => {
              if (item.route === 'VehicleTab') {
                navigation.dispatch(CommonActions.navigate({ name: 'Vehicle' }));
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
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 16,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 640,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 12,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 640,
  },
  stat: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    marginBottom: 10,
  },
  statHalf: { width: '46%', marginHorizontal: 6 },
  statNum: { fontSize: 26, fontWeight: 'bold', color: '#4a026f', textAlign: 'center' },
  statLabel: { fontSize: 12, color: '#707173', marginTop: 4, textAlign: 'center' },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  statusTitle: { fontSize: 14, fontWeight: '700', color: '#4a026f', marginBottom: 6 },
  statusBody: { fontSize: 14, color: '#707173', lineHeight: 20 },
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
    shadowColor: '#4a026f',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
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
});
