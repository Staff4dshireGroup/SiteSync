import React, { useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { notificationsService } from '@sitesync/shared';
import type { Notification } from '@sitesync/shared';

function NotificationItem({
  item,
  onMarkRead,
  onDismiss,
  onAttend,
  actionsDisabled,
}: {
  item: Notification;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onAttend: (item: Notification) => void;
  actionsDisabled: boolean;
}) {
  const canMarkRead = !item.read;

  const leftAction = (
    <View style={[styles.swipeAction, styles.swipeRead]}>
      <Text style={styles.swipeActionText}>Mark read</Text>
    </View>
  );
  const rightAction = (
    <View style={[styles.swipeAction, styles.swipeDismiss]}>
      <Text style={styles.swipeActionText}>Dismiss</Text>
    </View>
  );

  return (
    <Swipeable
      enabled={!actionsDisabled}
      friction={2}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={() => (canMarkRead ? leftAction : <View />)}
      renderRightActions={() => rightAction}
      onSwipeableOpen={(direction) => {
        if (direction === 'left' && canMarkRead) {
          onMarkRead(item.id);
        }
        if (direction === 'right') {
          onDismiss(item.id);
        }
      }}
    >
      <View style={[styles.item, !item.read && styles.unread]}>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.body}>{item.body}</Text>
        <View style={styles.actionsRow}>
          {!item.read ? (
            <TouchableOpacity
              style={[styles.actionBtn, actionsDisabled && styles.actionBtnDisabled]}
              onPress={() => onMarkRead(item.id)}
              disabled={actionsDisabled}
            >
              <Text style={styles.actionBtnText}>Mark as read</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.actionBtn, actionsDisabled && styles.actionBtnDisabled]}
            onPress={() => onDismiss(item.id)}
            disabled={actionsDisabled}
          >
            <Text style={styles.actionBtnText}>Dismiss</Text>
          </TouchableOpacity>
          {item.action_route ? (
            <TouchableOpacity
              style={[styles.actionBtn, actionsDisabled && styles.actionBtnDisabled]}
              onPress={() => onAttend(item)}
              disabled={actionsDisabled}
            >
              <Text style={styles.actionBtnText}>Attend</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Swipeable>
  );
}

export function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const attendToNotification = (item: Notification) => {
    if (!item.action_route) return;
    if (!item.read) markReadMutation.mutate(item.id);
    if (item.action_route === 'Vehicles') {
      navigation.navigate('Vehicles', item.action_params ?? undefined);
      return;
    }
    try {
      navigation.navigate('Home', {
        screen: item.action_route,
        params: item.action_params ?? undefined,
      });
    } catch {
      navigation.navigate(item.action_route, item.action_params ?? undefined);
    }
  };


  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }, [queryClient])
  );

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsService.getAll(),
  });
  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsService.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const dismissMutation = useMutation({
    mutationFn: (id: string) => notificationsService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  if (isLoading) return <View style={styles.centered}><Text>Loading...</Text></View>;

  return (
    <View style={styles.container}>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <NotificationItem
            item={item}
            onMarkRead={(id) => markReadMutation.mutate(id)}
            onDismiss={(id) => dismissMutation.mutate(id)}
            onAttend={attendToNotification}
            actionsDisabled={markReadMutation.isPending || dismissMutation.isPending}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  item: {
    backgroundColor: '#fff',
    padding: 16,
    marginBottom: 8,
    borderRadius: 8,
  },
  unread: { backgroundColor: '#f0e6f5' },
  title: { fontSize: 14, fontWeight: '600', color: '#4a026f' },
  body: { fontSize: 12, color: '#707173', marginTop: 4 },
  actionsRow: { flexDirection: 'row', marginTop: 10 },
  actionBtn: {
    borderWidth: 1,
    borderColor: '#4a026f',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 8,
    backgroundColor: '#fff',
  },
  dismissBtn: { borderColor: '#707173' },
  actionBtnDisabled: { opacity: 0.6 },
  actionBtnText: { fontSize: 12, fontWeight: '600', color: '#4a026f' },
  swipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 120,
    marginBottom: 8,
    borderRadius: 8,
  },
  swipeRead: { backgroundColor: '#2e7d32' },
  swipeDismiss: { backgroundColor: '#8a1f1f' },
  swipeActionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
