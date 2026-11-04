import type { Prisma, XeroTimeSyncStatus } from '@prisma/client';
import { prisma } from '../db';
import { logXeroAudit } from '../lib/xeroAudit';
import { scopesIncludeProjects } from './xeroConnectionService';
import { ensureTaskForLink } from './xeroProjectSync';
import { createXeroTimeEntry, listXeroProjectUsers } from './xeroProjectsApi';
import { mapTimeEntryToXero, resolveXeroUser } from './xeroTimeMapping';

const DEFAULT_PUSH_LIMIT = 100;

export type TimePushResult = {
  time_entry_id: string;
  status: 'synced' | 'skipped' | 'failed';
  xero_time_id?: string | null;
  error?: string;
};

type EntryWithRelations = Prisma.TimeEntryGetPayload<{
  include: {
    user: true;
    project: { include: { xeroProjectLink: true } };
    xeroTimeSync: true;
  };
}>;

export async function pushApprovedTime(opts: {
  companyId: string;
  actorUserId?: string | null;
  projectId?: string;
  timeEntryId?: string;
  limit?: number;
}): Promise<{ results: TimePushResult[]; truncated: boolean }> {
  const connection = await prisma.xeroConnection.findUnique({ where: { companyId: opts.companyId } });
  if (!connection || connection.status !== 'active' || !connection.xeroTenantId) {
    throw new Error('No active Xero connection for this company');
  }
  if (!scopesIncludeProjects(connection.scopes)) {
    throw new Error('Xero connection is missing the projects scope; disconnect and connect again');
  }

  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PUSH_LIMIT, 1), 200);
  const where: Prisma.TimeEntryWhereInput = {
    approvedAt: { not: null },
    signOutAt: { not: null },
    project: {
      companyId: opts.companyId,
      deletedAt: null,
      ...(opts.projectId ? { id: opts.projectId } : {}),
    },
    ...(opts.timeEntryId ? { id: opts.timeEntryId } : {}),
  };
  if (!opts.timeEntryId) {
    where.NOT = {
      xeroTimeSync: {
        is: {
          status: 'synced',
          xeroTenantId: connection.xeroTenantId,
          xeroTimeId: { not: null },
        },
      },
    };
  }

  const entries = await prisma.timeEntry.findMany({
    where,
    include: {
      user: true,
      project: { include: { xeroProjectLink: true } },
      xeroTimeSync: true,
    },
    orderBy: { approvedAt: 'asc' },
    take: limit + 1,
  });
  const truncated = entries.length > limit;
  const batch = entries.slice(0, limit);
  const xeroUsers = batch.length ? await listXeroProjectUsers(opts.companyId) : [];
  const taskCache = new Map<string, string>();
  const results: TimePushResult[] = [];

  for (const entry of batch) {
    results.push(await pushOne(entry, connection.xeroTenantId, connection.defaultXeroUserId, xeroUsers, taskCache));
  }

  const failed = results.filter((row) => row.status === 'failed');
  const synced = results.filter((row) => row.status === 'synced').length;
  if (results.length) {
    await prisma.xeroConnection.update({
      where: { companyId: opts.companyId },
      data: {
        lastTimePushAt: new Date(),
        ...(synced > 0 ? { lastSyncedAt: new Date() } : {}),
        ...(failed.length
          ? { lastSyncError: failed[0]?.error ?? 'Time push failed' }
          : synced > 0
            ? { lastSyncError: null }
            : {}),
      },
    });
  }
  await logXeroAudit({
    companyId: opts.companyId,
    userId: opts.actorUserId,
    action: failed.length ? 'time_push_failed' : 'time_pushed',
    detail: `synced=${synced} failed=${failed.length} skipped=${results.length - synced - failed.length}`,
    meta: { timeEntryId: opts.timeEntryId ?? null, projectId: opts.projectId ?? null },
  });

  return { results, truncated };
}

async function pushOne(
  entry: EntryWithRelations,
  tenantId: string,
  defaultXeroUserId: string | null,
  xeroUsers: { userId: string; email: string | null; name: string }[],
  taskCache: Map<string, string>
): Promise<TimePushResult> {
  const already =
    entry.xeroTimeSync?.status === 'synced' &&
    !!entry.xeroTimeSync.xeroTimeId &&
    entry.xeroTimeSync.xeroTenantId === tenantId;
  if (already) {
    return {
      time_entry_id: entry.id,
      status: 'skipped',
      xero_time_id: entry.xeroTimeSync?.xeroTimeId,
      error: 'Already synced to this Xero organisation',
    };
  }

  const link = entry.project.xeroProjectLink;
  let taskId = link?.xeroTaskId ?? null;
  let userId: string | null = null;
  let userMatch: 'email' | 'default' | null = null;
  if (link) {
    const resolved = resolveXeroUser({
      staffEmail: entry.user.email,
      xeroUsers,
      defaultUserId: defaultXeroUserId,
    });
    if (!resolved.ok) {
      await recordSync(entry, {
        status: 'failed',
        error: resolved.error,
        xeroProjectId: link.xeroProjectId,
        xeroTenantId: tenantId,
      });
      return { time_entry_id: entry.id, status: 'failed', error: resolved.error };
    }
    userId = resolved.userId;
    userMatch = resolved.matchedBy;
    try {
      const cacheKey = link.xeroProjectId;
      taskId = taskCache.get(cacheKey) ?? taskId;
      if (!taskId || !taskCache.has(cacheKey)) {
        taskId = await ensureTaskForLink(entry.project.companyId, link.id, link.xeroProjectId, taskId);
        taskCache.set(cacheKey, taskId);
      }
    } catch (e) {
      const message = (e as Error).message;
      await recordSync(entry, {
        status: 'failed',
        error: message,
        xeroProjectId: link.xeroProjectId,
        xeroTenantId: tenantId,
        xeroUserId: userId,
        userMatch,
      });
      return { time_entry_id: entry.id, status: 'failed', error: message };
    }
  }

  const mapped = mapTimeEntryToXero({
    timeEntryId: entry.id,
    signInAt: entry.signInAt,
    signOutAt: entry.signOutAt,
    approvedAt: entry.approvedAt,
    travelMinutes: entry.travelMinutes,
    travelMiles: entry.travelMiles,
    staffName: `${entry.user.firstName} ${entry.user.lastName}`.trim(),
    staffEmail: entry.user.email,
    projectName: entry.project.name,
    xeroProjectId: link?.xeroProjectId ?? null,
    xeroUserId: userId,
    xeroTaskId: taskId,
    userMatch,
    alreadySynced: false,
  });

  if (!mapped.ok) {
    await recordSync(entry, {
      status: mapped.status,
      error: mapped.error,
      xeroProjectId: link?.xeroProjectId ?? null,
      xeroTenantId: tenantId,
      xeroUserId: userId,
      xeroTaskId: taskId,
      userMatch,
    });
    return { time_entry_id: entry.id, status: mapped.status, error: mapped.error };
  }

  try {
    const created = await createXeroTimeEntry(entry.project.companyId, link!.xeroProjectId, mapped.body, mapped.idempotencyKey);
    await recordSync(entry, {
      status: 'synced',
      error: null,
      xeroTimeId: created.timeEntryId,
      xeroProjectId: link!.xeroProjectId,
      xeroTenantId: tenantId,
      xeroUserId: mapped.body.userId,
      xeroTaskId: mapped.body.taskId,
      userMatch: mapped.userMatch,
      durationMinutes: mapped.duration,
    });
    return { time_entry_id: entry.id, status: 'synced', xero_time_id: created.timeEntryId };
  } catch (e) {
    const message = (e as Error).message;
    await recordSync(entry, {
      status: 'failed',
      error: message,
      xeroProjectId: link!.xeroProjectId,
      xeroTenantId: tenantId,
      xeroUserId: mapped.body.userId,
      xeroTaskId: mapped.body.taskId,
      userMatch: mapped.userMatch,
      durationMinutes: mapped.duration,
    });
    return { time_entry_id: entry.id, status: 'failed', error: message };
  }
}

async function recordSync(
  entry: EntryWithRelations,
  data: {
    status: XeroTimeSyncStatus;
    error: string | null;
    xeroTimeId?: string | null;
    xeroProjectId?: string | null;
    xeroTenantId?: string | null;
    xeroUserId?: string | null;
    xeroTaskId?: string | null;
    userMatch?: 'email' | 'default' | null;
    durationMinutes?: number | null;
  }
) {
  const now = new Date();
  const shared = {
    companyId: entry.project.companyId,
    projectId: entry.projectId,
    status: data.status,
    error: data.error,
    xeroProjectId: data.xeroProjectId ?? null,
    xeroTenantId: data.xeroTenantId ?? null,
    xeroUserId: data.xeroUserId ?? null,
    xeroTaskId: data.xeroTaskId ?? null,
    userMatch: data.userMatch ?? null,
    durationMinutes: data.durationMinutes ?? null,
    lastAttemptAt: now,
    syncedAt: data.status === 'synced' ? now : null,
    ...(data.xeroTimeId ? { xeroTimeId: data.xeroTimeId } : {}),
  };
  await prisma.xeroTimeSync.upsert({
    where: { timeEntryId: entry.id },
    create: {
      timeEntryId: entry.id,
      attempts: 1,
      ...shared,
    },
    update: {
      ...shared,
      attempts: { increment: 1 },
    },
  });
}

export async function getCompanyXeroSummary(companyId: string) {
  const [connection, groups, recent] = await Promise.all([
    prisma.xeroConnection.findUnique({ where: { companyId } }),
    prisma.xeroTimeSync.groupBy({
      by: ['status'],
      where: { companyId },
      _count: { _all: true },
    }),
    prisma.xeroTimeSync.findMany({
      where: { companyId, status: 'failed', error: { not: null } },
      orderBy: { lastAttemptAt: 'desc' },
      take: 8,
      select: { timeEntryId: true, error: true, lastAttemptAt: true },
    }),
  ]);
  const counts = { synced: 0, failed: 0, skipped: 0, pending: 0 };
  for (const group of groups) {
    counts[group.status] = group._count._all;
  }
  return {
    last_sync_error: connection?.lastSyncError ?? null,
    last_time_push_at: connection?.lastTimePushAt?.toISOString() ?? null,
    default_xero_user_id: connection?.defaultXeroUserId ?? null,
    default_xero_user_name: connection?.defaultXeroUserName ?? null,
    projects_scope: scopesIncludeProjects(connection?.scopes),
    time_sync: counts,
    recent_errors: recent.map((row) => ({
      time_entry_id: row.timeEntryId,
      error: row.error ?? '',
      at: row.lastAttemptAt?.toISOString() ?? null,
    })),
  };
}

export function pushOnApprovalEnabled(): boolean {
  return process.env.XERO_PUSH_ON_APPROVAL?.trim().toLowerCase() !== 'false';
}
