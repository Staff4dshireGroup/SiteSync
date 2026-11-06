import { xeroRequest } from './xeroConnectionService';

export type XeroProjectItem = {
  projectId: string;
  contactId: string | null;
  name: string;
  status: string;
  currencyCode: string | null;
  minutesLogged: number | null;
};

export type XeroProjectUser = {
  userId: string;
  name: string;
  email: string | null;
};

export type XeroTaskItem = {
  taskId: string;
  projectId: string | null;
  name: string;
  chargeType: string;
  status: string;
};

export type XeroContactItem = {
  contactId: string;
  name: string;
  email: string | null;
  isCustomer: boolean;
  status: string;
};

type PageInfo = { page?: number; pageCount?: number };

async function eachPage<T>(
  load: (page: number) => Promise<{ items: T[]; pagination?: PageInfo }>,
  maxPages = 20
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await load(page);
    all.push(...res.items);
    if (res.items.length === 0) break;
    const pageCount = res.pagination?.pageCount;
    if (pageCount != null && page >= pageCount) break;
    if (pageCount == null && res.items.length < 100) break;
  }
  return all;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function mapProject(raw: unknown): XeroProjectItem {
  const row = asRecord(raw);
  return {
    projectId: String(row.projectId ?? ''),
    contactId: row.contactId != null ? String(row.contactId) : null,
    name: String(row.name ?? ''),
    status: String(row.status ?? ''),
    currencyCode: row.currencyCode != null ? String(row.currencyCode) : null,
    minutesLogged: typeof row.minutesLogged === 'number' ? row.minutesLogged : null,
  };
}

export async function listXeroProjects(
  companyId: string,
  opts?: { states?: string; contactId?: string }
): Promise<XeroProjectItem[]> {
  const items = await eachPage(async (page) => {
    const data = asRecord(
      await xeroRequest(companyId, {
        api: 'projects',
        method: 'GET',
        path: '/Projects',
        query: {
          page: String(page),
          pageSize: '100',
          states: opts?.states,
          contactID: opts?.contactId,
        },
      })
    );
    const rows = Array.isArray(data.items) ? data.items : [];
    return { items: rows.map(mapProject).filter((p) => p.projectId), pagination: data.pagination as PageInfo };
  });
  return items;
}

export async function getXeroProject(companyId: string, projectId: string): Promise<XeroProjectItem> {
  const data = await xeroRequest(companyId, {
    api: 'projects',
    method: 'GET',
    path: `/Projects/${projectId}`,
  });
  const mapped = mapProject(data);
  if (!mapped.projectId) throw new Error('Xero did not return a project');
  return mapped;
}

export async function createXeroProject(
  companyId: string,
  body: { contactId: string; name: string; deadlineUtc?: string }
): Promise<XeroProjectItem> {
  const data = await xeroRequest(companyId, {
    api: 'projects',
    method: 'POST',
    path: '/Projects',
    body: {
      contactId: body.contactId,
      name: body.name,
      ...(body.deadlineUtc ? { deadlineUtc: body.deadlineUtc } : {}),
    },
    idempotencyKey: `sitesync-project-${body.contactId}-${body.name}`.slice(0, 128),
  });
  const mapped = mapProject(data);
  if (!mapped.projectId) throw new Error('Xero did not return the created project');
  return mapped;
}

export async function listXeroProjectUsers(companyId: string): Promise<XeroProjectUser[]> {
  return eachPage(async (page) => {
    const data = asRecord(
      await xeroRequest(companyId, {
        api: 'projects',
        method: 'GET',
        path: '/ProjectsUsers',
        query: { page: String(page), pageSize: '100' },
      })
    );
    const rows = Array.isArray(data.items) ? data.items : [];
    const items = rows.map((raw) => {
      const row = asRecord(raw);
      return {
        userId: String(row.userId ?? ''),
        name: String(row.name ?? ''),
        email: row.email != null ? String(row.email) : null,
      };
    }).filter((user) => user.userId);
    return { items, pagination: data.pagination as PageInfo };
  });
}

export async function listXeroTasks(companyId: string, projectId: string): Promise<XeroTaskItem[]> {
  return eachPage(async (page) => {
    const data = asRecord(
      await xeroRequest(companyId, {
        api: 'projects',
        method: 'GET',
        path: `/Projects/${projectId}/Tasks`,
        query: { page: String(page), pageSize: '100' },
      })
    );
    const rows = Array.isArray(data.items) ? data.items : [];
    const items = rows.map((raw) => {
      const row = asRecord(raw);
      return {
        taskId: String(row.taskId ?? ''),
        projectId: row.projectId != null ? String(row.projectId) : null,
        name: String(row.name ?? ''),
        chargeType: String(row.chargeType ?? ''),
        status: String(row.status ?? ''),
      };
    }).filter((task) => task.taskId);
    return { items, pagination: data.pagination as PageInfo };
  });
}

export function defaultTaskName(): string {
  return process.env.XERO_DEFAULT_TASK_NAME?.trim() || 'Site labour';
}

export function defaultTaskRate(): { currency: string; value: number } {
  const currency = (process.env.XERO_DEFAULT_CURRENCY?.trim() || 'GBP').toUpperCase();
  const parsed = Number(process.env.XERO_DEFAULT_TASK_RATE ?? '0');
  const value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  return { currency, value };
}

export async function createXeroTask(
  companyId: string,
  projectId: string,
  task?: { name?: string; currency?: string; rate?: number }
): Promise<XeroTaskItem> {
  const rate = defaultTaskRate();
  const name = task?.name?.trim() || defaultTaskName();
  const data = asRecord(
    await xeroRequest(companyId, {
      api: 'projects',
      method: 'POST',
      path: `/Projects/${projectId}/Tasks`,
      body: {
        name,
        chargeType: 'TIME',
        rate: {
          currency: task?.currency ?? rate.currency,
          value: task?.rate ?? rate.value,
        },
        estimateMinutes: 60,
      },
      idempotencyKey: `sitesync-task-${projectId}-${name}`.slice(0, 128),
    })
  );
  return {
    taskId: String(data.taskId ?? ''),
    projectId: data.projectId != null ? String(data.projectId) : projectId,
    name: String(data.name ?? name),
    chargeType: String(data.chargeType ?? 'TIME'),
    status: String(data.status ?? 'ACTIVE'),
  };
}

export async function createXeroTimeEntry(
  companyId: string,
  projectId: string,
  body: {
    userId: string;
    taskId: string;
    dateUtc: string;
    duration: number;
    description?: string;
  },
  idempotencyKey: string
): Promise<{ timeEntryId: string }> {
  const data = asRecord(
    await xeroRequest(companyId, {
      api: 'projects',
      method: 'POST',
      path: `/Projects/${projectId}/Time`,
      body,
      idempotencyKey,
    })
  );
  const timeEntryId = String(data.timeEntryId ?? '');
  if (!timeEntryId) throw new Error('Xero did not return a time entry id');
  return { timeEntryId };
}

export async function listXeroContacts(companyId: string, search?: string): Promise<XeroContactItem[]> {
  const safeSearch = (search ?? '').replace(/["\\&|]/g, '').trim();
  const where = safeSearch
    ? `ContactStatus=="ACTIVE"&&Name.Contains("${safeSearch}")`
    : 'ContactStatus=="ACTIVE"';
  const all: XeroContactItem[] = [];
  for (let page = 1; page <= 10; page++) {
    const data = asRecord(
      await xeroRequest(companyId, {
        api: 'accounting',
        method: 'GET',
        path: '/Contacts',
        query: { page: String(page), where },
      })
    );
    const rows = Array.isArray(data.Contacts) ? data.Contacts : [];
    for (const raw of rows) {
      const row = asRecord(raw);
      const contactId = String(row.ContactID ?? '');
      if (!contactId) continue;
      all.push({
        contactId,
        name: String(row.Name ?? ''),
        email: row.EmailAddress != null && String(row.EmailAddress).trim() ? String(row.EmailAddress) : null,
        isCustomer: row.IsCustomer !== false,
        status: String(row.ContactStatus ?? ''),
      });
    }
    if (rows.length < 100) break;
  }
  return all;
}
