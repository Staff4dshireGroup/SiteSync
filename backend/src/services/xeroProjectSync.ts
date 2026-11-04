import type { XeroProjectLinkMethod } from '@prisma/client';
import { prisma } from '../db';
import { logXeroAudit } from '../lib/xeroAudit';
import {
  buildXeroProjectName,
  extractJobCodeFromProject,
  matchXeroProjectsByJobCode,
} from './xeroTimeMapping';
import {
  createXeroProject,
  createXeroTask,
  defaultTaskName,
  getXeroProject,
  listXeroContacts,
  listXeroProjectUsers,
  listXeroProjects,
  listXeroTasks,
  type XeroContactItem,
  type XeroProjectItem,
  type XeroProjectUser,
} from './xeroProjectsApi';

export async function forgetLinksIfTenantChanged(
  companyId: string,
  previousTenantId: string | null | undefined,
  nextTenantId: string
): Promise<void> {
  if (!previousTenantId || previousTenantId === nextTenantId) return;
  const removed = await prisma.xeroProjectLink.deleteMany({ where: { companyId } });
  if (removed.count > 0) {
    await logXeroAudit({
      companyId,
      action: 'project_unlinked',
      detail: 'Xero organisation changed; project links cleared',
      meta: { previousTenantId, nextTenantId, count: removed.count },
    });
  }
}

export type ProjectLinkView = {
  project_id: string;
  project_name: string;
  address: string | null;
  job_code: string | null;
  suggested_name: string;
  link: null | {
    xero_project_id: string;
    xero_project_name: string;
    xero_contact_id: string | null;
    xero_task_id: string | null;
    method: XeroProjectLinkMethod;
    linked_at: string;
  };
};

export async function listProjectLinks(companyId: string, projectId?: string): Promise<ProjectLinkView[]> {
  const projects = await prisma.project.findMany({
    where: {
      companyId,
      deletedAt: null,
      ...(projectId ? { id: projectId } : {}),
    },
    include: { xeroProjectLink: true },
    orderBy: { name: 'asc' },
  });
  return projects.map((project) => {
    const link = project.xeroProjectLink;
    return {
      project_id: project.id,
      project_name: project.name,
      address: project.address,
      job_code: extractJobCodeFromProject(project),
      suggested_name: buildXeroProjectName(project),
      link: link
        ? {
            xero_project_id: link.xeroProjectId,
            xero_project_name: link.xeroProjectName,
            xero_contact_id: link.xeroContactId,
            xero_task_id: link.xeroTaskId,
            method: link.method,
            linked_at: link.linkedAt.toISOString(),
          }
        : null,
    };
  });
}

async function assertSiteProject(companyId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId, deletedAt: null },
  });
  if (!project) {
    const err = new Error('Project not found');
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  return project;
}

async function saveLink(input: {
  companyId: string;
  projectId: string;
  xeroProjectId: string;
  xeroProjectName: string;
  xeroContactId: string | null;
  method: XeroProjectLinkMethod;
  userId?: string | null;
}) {
  const taken = await prisma.xeroProjectLink.findFirst({
    where: {
      companyId: input.companyId,
      xeroProjectId: input.xeroProjectId,
      NOT: { projectId: input.projectId },
    },
  });
  if (taken) {
    const err = new Error('That Xero project is already linked to another SiteSync project');
    (err as Error & { status?: number }).status = 409;
    throw err;
  }
  return prisma.xeroProjectLink.upsert({
    where: { projectId: input.projectId },
    create: {
      projectId: input.projectId,
      companyId: input.companyId,
      xeroProjectId: input.xeroProjectId,
      xeroProjectName: input.xeroProjectName,
      xeroContactId: input.xeroContactId,
      method: input.method,
      linkedByUserId: input.userId ?? null,
    },
    update: {
      xeroProjectId: input.xeroProjectId,
      xeroProjectName: input.xeroProjectName,
      xeroContactId: input.xeroContactId,
      method: input.method,
      linkedByUserId: input.userId ?? null,
      linkedAt: new Date(),
      xeroTaskId: null,
    },
  });
}

export async function linkProjectManually(input: {
  companyId: string;
  projectId: string;
  xeroProjectId: string;
  userId?: string | null;
}) {
  await assertSiteProject(input.companyId, input.projectId);
  const remote = await getXeroProject(input.companyId, input.xeroProjectId);
  const link = await saveLink({
    companyId: input.companyId,
    projectId: input.projectId,
    xeroProjectId: remote.projectId,
    xeroProjectName: remote.name,
    xeroContactId: remote.contactId,
    method: 'manual',
    userId: input.userId,
  });
  await logXeroAudit({
    companyId: input.companyId,
    userId: input.userId,
    action: 'project_linked',
    detail: remote.name,
    meta: { projectId: input.projectId, xeroProjectId: remote.projectId, method: 'manual' },
  });
  return link;
}

export async function unlinkProject(companyId: string, projectId: string, userId?: string | null) {
  await assertSiteProject(companyId, projectId);
  await prisma.xeroProjectLink.deleteMany({ where: { projectId, companyId } });
  await logXeroAudit({
    companyId,
    userId,
    action: 'project_unlinked',
    detail: projectId,
    meta: { projectId },
  });
}

export async function matchProjectByPrefix(input: {
  companyId: string;
  projectId: string;
  userId?: string | null;
  apply?: boolean;
}) {
  const project = await assertSiteProject(input.companyId, input.projectId);
  const remote = await listXeroProjects(input.companyId, { states: 'INPROGRESS' });
  const { code, matches } = matchXeroProjectsByJobCode(project, remote);
  const suggested_name = buildXeroProjectName(project);
  const apply = input.apply !== false;
  if (!apply || matches.length !== 1) {
    return {
      job_code: code,
      suggested_name,
      matches: matches.map(toPublicProject),
      linked: false as const,
    };
  }
  const chosen = matches[0];
  const link = await saveLink({
    companyId: input.companyId,
    projectId: project.id,
    xeroProjectId: chosen.projectId,
    xeroProjectName: chosen.name,
    xeroContactId: chosen.contactId,
    method: 'prefix',
    userId: input.userId,
  });
  await logXeroAudit({
    companyId: input.companyId,
    userId: input.userId,
    action: 'project_linked',
    detail: chosen.name,
    meta: { projectId: project.id, xeroProjectId: chosen.projectId, method: 'prefix', job_code: code },
  });
  return {
    job_code: code,
    suggested_name,
    matches: matches.map(toPublicProject),
    linked: true as const,
    link: {
      xero_project_id: link.xeroProjectId,
      xero_project_name: link.xeroProjectName,
      method: link.method,
    },
  };
}

export async function matchAllProjectsByPrefix(companyId: string, userId?: string | null) {
  const projects = await prisma.project.findMany({
    where: { companyId, deletedAt: null, xeroProjectLink: null },
    orderBy: { name: 'asc' },
  });
  const remote = await listXeroProjects(companyId, { states: 'INPROGRESS' });
  const linked: { project_id: string; xero_project_id: string; xero_project_name: string; job_code: string }[] = [];
  const ambiguous: { project_id: string; project_name: string; job_code: string; matches: ReturnType<typeof toPublicProject>[] }[] = [];
  const unmatched: { project_id: string; project_name: string; job_code: string | null }[] = [];

  for (const project of projects) {
    const { code, matches } = matchXeroProjectsByJobCode(project, remote);
    if (!code || matches.length === 0) {
      unmatched.push({ project_id: project.id, project_name: project.name, job_code: code });
      continue;
    }
    if (matches.length > 1) {
      ambiguous.push({
        project_id: project.id,
        project_name: project.name,
        job_code: code,
        matches: matches.map(toPublicProject),
      });
      continue;
    }
    const chosen = matches[0];
    try {
      await saveLink({
        companyId,
        projectId: project.id,
        xeroProjectId: chosen.projectId,
        xeroProjectName: chosen.name,
        xeroContactId: chosen.contactId,
        method: 'prefix',
        userId,
      });
      linked.push({
        project_id: project.id,
        xero_project_id: chosen.projectId,
        xero_project_name: chosen.name,
        job_code: code,
      });
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 409) {
        ambiguous.push({
          project_id: project.id,
          project_name: project.name,
          job_code: code,
          matches: [toPublicProject(chosen)],
        });
        continue;
      }
      throw e;
    }
  }

  await prisma.xeroConnection.updateMany({
    where: { companyId },
    data: { lastSyncedAt: new Date(), lastSyncError: null },
  });
  await logXeroAudit({
    companyId,
    userId,
    action: 'projects_matched',
    detail: `linked=${linked.length} ambiguous=${ambiguous.length} unmatched=${unmatched.length}`,
  });
  return { linked, ambiguous, unmatched };
}

export async function createAndLinkProject(input: {
  companyId: string;
  projectId: string;
  contactId: string;
  name?: string | null;
  userId?: string | null;
}) {
  const project = await assertSiteProject(input.companyId, input.projectId);
  const name = (input.name?.trim() || buildXeroProjectName(project)).slice(0, 200);
  if (!input.contactId?.trim()) {
    const err = new Error('contact_id required');
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  const created = await createXeroProject(input.companyId, {
    contactId: input.contactId.trim(),
    name,
  });
  const link = await saveLink({
    companyId: input.companyId,
    projectId: project.id,
    xeroProjectId: created.projectId,
    xeroProjectName: created.name || name,
    xeroContactId: created.contactId ?? input.contactId,
    method: 'created',
    userId: input.userId,
  });
  const task = await ensureTaskForLink(input.companyId, link.id, created.projectId, link.xeroTaskId);
  await logXeroAudit({
    companyId: input.companyId,
    userId: input.userId,
    action: 'project_created',
    detail: created.name || name,
    meta: { projectId: project.id, xeroProjectId: created.projectId, taskId: task },
  });
  return { link, task_id: task, suggested_name: name };
}

export async function ensureTaskForLink(
  companyId: string,
  linkId: string,
  xeroProjectId: string,
  cachedTaskId: string | null
): Promise<string> {
  if (cachedTaskId) return cachedTaskId;
  const wanted = defaultTaskName().toLowerCase();
  const tasks = await listXeroTasks(companyId, xeroProjectId);
  const existing = tasks.find(
    (task) => task.name.toLowerCase() === wanted && task.chargeType === 'TIME' && task.status === 'ACTIVE'
  );
  const taskId = existing?.taskId || (await createXeroTask(companyId, xeroProjectId)).taskId;
  if (!taskId) throw new Error('Xero did not return a task id');
  await prisma.xeroProjectLink.update({
    where: { id: linkId },
    data: { xeroTaskId: taskId },
  });
  return taskId;
}

export async function pullContacts(companyId: string, search: string | undefined, userId?: string | null) {
  const contacts = await listXeroContacts(companyId, search);
  await prisma.xeroConnection.updateMany({
    where: { companyId },
    data: { lastSyncedAt: new Date(), lastSyncError: null },
  });
  await logXeroAudit({
    companyId,
    userId,
    action: 'contacts_listed',
    detail: `count=${contacts.length}`,
  });
  return contacts.map(toPublicContact);
}

export async function pullProjects(companyId: string, userId?: string | null, states?: string) {
  const projects = await listXeroProjects(companyId, { states: states ?? 'INPROGRESS' });
  await prisma.xeroConnection.updateMany({
    where: { companyId },
    data: { lastSyncedAt: new Date(), lastSyncError: null },
  });
  await logXeroAudit({
    companyId,
    userId,
    action: 'projects_listed',
    detail: `count=${projects.length}`,
  });
  return projects.map(toPublicProject);
}

export async function pullUsers(companyId: string, userId?: string | null) {
  const users = await listXeroProjectUsers(companyId);
  await logXeroAudit({
    companyId,
    userId,
    action: 'users_listed',
    detail: `count=${users.length}`,
  });
  return users.map(toPublicUser);
}

export async function setDefaultXeroUser(companyId: string, xeroUserId: string | null, userId?: string | null) {
  let name: string | null = null;
  if (xeroUserId) {
    const users = await listXeroProjectUsers(companyId);
    const found = users.find((user) => user.userId === xeroUserId);
    if (!found) {
      const err = new Error('Xero user not found in this organisation');
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
    name = found.name || found.email;
  }
  await prisma.xeroConnection.update({
    where: { companyId },
    data: { defaultXeroUserId: xeroUserId, defaultXeroUserName: name },
  });
  await logXeroAudit({
    companyId,
    userId,
    action: 'default_user_set',
    detail: name ?? 'cleared',
    meta: { xeroUserId },
  });
  return { default_xero_user_id: xeroUserId, default_xero_user_name: name };
}

export function toPublicProject(project: XeroProjectItem) {
  return {
    project_id: project.projectId,
    contact_id: project.contactId,
    name: project.name,
    status: project.status,
    currency_code: project.currencyCode,
    minutes_logged: project.minutesLogged,
    job_code: extractJobCodeFromProject({ name: project.name }),
  };
}

function toPublicContact(contact: XeroContactItem) {
  return {
    contact_id: contact.contactId,
    name: contact.name,
    email: contact.email,
    is_customer: contact.isCustomer,
    status: contact.status,
  };
}

function toPublicUser(user: XeroProjectUser) {
  return {
    user_id: user.userId,
    name: user.name,
    email: user.email,
  };
}

export function httpStatusOf(error: unknown): number | undefined {
  return (error as { status?: number }).status;
}
