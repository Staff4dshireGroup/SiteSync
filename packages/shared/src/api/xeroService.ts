import axiosInstance from './axiosInstance';

/** Normalised sales invoice row from GET /xero/invoices (Xero ACCREC). */
export type XeroInvoiceListItem = {
  id: string;
  invoice_number: string;
  type: string;
  reference: string | null;
  contact_name: string | null;
  date: string | null;
  due_date: string | null;
  status: string;
  total: number | null;
  amount_due: number | null;
  amount_paid: number | null;
  currency_code: string | null;
};

export type XeroInvoicesResponse = {
  invoices: XeroInvoiceListItem[];
  page: number;
};

export type XeroAccountOption = {
  code: string;
  name: string;
  type: string;
};

export type XeroAccountsResponse = {
  accounts: XeroAccountOption[];
};

export type XeroCreateInvoiceLine = {
  description: string;
  quantity: number;
  unit_amount: number;
  account_code: string;
};

export type XeroCreateInvoicePayload = {
  companyId: string;
  contact_id?: string;
  contact_name?: string;
  date?: string;
  due_date?: string;
  reference?: string;
  /** DRAFT keeps it editable in Xero; AUTHORISED issues it (subject to Xero org rules). */
  status?: 'DRAFT' | 'AUTHORISED' | 'SUBMITTED';
  line_items: XeroCreateInvoiceLine[];
};

export type XeroTenantOption = {
  tenantId: string;
  tenantName: string;
  connectionId: string;
};

export type XeroTimeSyncCounts = {
  synced: number;
  failed: number;
  skipped: number;
  pending: number;
};

export type XeroSyncSummary = {
  last_sync_error?: string | null;
  last_time_push_at?: string | null;
  default_xero_user_id?: string | null;
  default_xero_user_name?: string | null;
  projects_scope?: boolean;
  time_sync?: XeroTimeSyncCounts;
  recent_errors?: { time_entry_id: string; error: string; at: string | null }[];
};

export type XeroStatusResponse = (
  | {
      status: 'connected';
      company_id: string;
      xero_connected: true;
      xero_tenant_id: string;
      xero_tenant_name?: string | null;
      connected_at?: string;
      connected_by_user_id?: string | null;
      last_refreshed_at?: string | null;
      last_synced_at?: string | null;
    }
  | {
      status: 'disconnected';
      company_id: string;
      xero_connected: false;
    }
  | {
      status: 'reauth_required';
      company_id: string;
      xero_connected: false;
      message?: string;
    }
  | {
      /** Multiple Xero orgs: user must pick one (see getPending + completePending). */
      status: 'pending_tenant';
      company_id: string;
      xero_connected: false;
      pending_id: string;
    }
) &
  XeroSyncSummary;

export type XeroProjectOption = {
  project_id: string;
  contact_id: string | null;
  name: string;
  status: string;
  currency_code: string | null;
  minutes_logged: number | null;
  job_code: string | null;
};

export type XeroProjectLinkView = {
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
    method: 'manual' | 'prefix' | 'created';
    linked_at: string;
  };
};

export type XeroContactOption = {
  contact_id: string;
  name: string;
  email: string | null;
  is_customer: boolean;
  status: string;
};

export type XeroUserOption = {
  user_id: string;
  name: string;
  email: string | null;
};

export type XeroTimePushResult = {
  time_entry_id: string;
  status: 'synced' | 'skipped' | 'failed';
  xero_time_id?: string | null;
  error?: string;
};

export type XeroAuditEntry = {
  id: string;
  action: string;
  detail: string | null;
  meta: unknown;
  created_at: string;
  user_id: string | null;
};

export const xeroService = {
  async getStatus(companyId: string): Promise<XeroStatusResponse> {
    const { data } = await axiosInstance.get<XeroStatusResponse>('/xero/status', {
      params: { company_id: companyId },
    });
    return data;
  },

  async getConnectStart(companyId: string): Promise<{ authorization_url: string }> {
    const { data } = await axiosInstance.get<{ authorization_url: string }>('/xero/connect/start', {
      params: { company_id: companyId },
    });
    return data;
  },

  async disconnect(companyId: string): Promise<{ ok: boolean; status: string; company_id: string }> {
    const { data } = await axiosInstance.post<{ ok: boolean; status: string; company_id: string }>(
      '/xero/disconnect',
      { company_id: companyId }
    );
    return data;
  },

  async getPending(pendingId: string): Promise<{ pending_id: string; tenants: XeroTenantOption[] }> {
    const { data } = await axiosInstance.get<{ pending_id: string; tenants: XeroTenantOption[] }>(
      `/xero/pending/${pendingId}`
    );
    return data;
  },

  async completePending(pendingId: string, tenantId: string): Promise<{ ok: boolean; status: string; company_id: string }> {
    const { data } = await axiosInstance.post<{ ok: boolean; status: string; company_id: string }>(
      '/xero/pending/complete',
      { pending_id: pendingId, tenant_id: tenantId }
    );
    return data;
  },

  /** Sales invoices (ACCREC) from the linked Xero organisation. */
  async listInvoices(params: {
    companyId: string;
    status?: string;
    page?: number;
  }): Promise<XeroInvoicesResponse> {
    const { data } = await axiosInstance.get<XeroInvoicesResponse>('/xero/invoices', {
      params: {
        company_id: params.companyId,
        status: params.status,
        page: params.page,
      },
    });
    return data;
  },

  /** Revenue-style accounts from the chart (for line item codes). */
  async listAccounts(companyId: string): Promise<XeroAccountsResponse> {
    const { data } = await axiosInstance.get<XeroAccountsResponse>('/xero/accounts', {
      params: { company_id: companyId },
    });
    return data;
  },

  /** Create a sales invoice (ACCREC) in the linked Xero organisation. */
  async createInvoice(payload: XeroCreateInvoicePayload): Promise<{ invoice: XeroInvoiceListItem }> {
    const { data } = await axiosInstance.post<{ invoice: XeroInvoiceListItem }>('/xero/invoices', {
      company_id: payload.companyId,
      contact_id: payload.contact_id,
      contact_name: payload.contact_name,
      date: payload.date,
      due_date: payload.due_date,
      reference: payload.reference,
      status: payload.status,
      line_items: payload.line_items,
    });
    return data;
  },

  async listProjects(companyId: string, states = 'INPROGRESS'): Promise<{ projects: XeroProjectOption[] }> {
    const { data } = await axiosInstance.get<{ projects: XeroProjectOption[] }>('/xero/projects', {
      params: { company_id: companyId, states },
    });
    return data;
  },

  async listProjectLinks(companyId: string, projectId?: string): Promise<{ projects: XeroProjectLinkView[] }> {
    const { data } = await axiosInstance.get<{ projects: XeroProjectLinkView[] }>('/xero/projects/links', {
      params: { company_id: companyId, project_id: projectId },
    });
    return data;
  },

  async linkProject(companyId: string, projectId: string, xeroProjectId: string) {
    const { data } = await axiosInstance.post('/xero/projects/link', {
      company_id: companyId,
      project_id: projectId,
      xero_project_id: xeroProjectId,
    });
    return data;
  },

  async matchProject(companyId: string, projectId: string, apply = true) {
    const { data } = await axiosInstance.post<{
      job_code: string | null;
      suggested_name: string;
      matches: XeroProjectOption[];
      linked: boolean;
    }>('/xero/projects/match', {
      company_id: companyId,
      project_id: projectId,
      apply,
    });
    return data;
  },

  async matchAllProjects(companyId: string) {
    const { data } = await axiosInstance.post<{
      linked: { project_id: string; xero_project_name: string; job_code: string }[];
      ambiguous: { project_id: string; project_name: string; job_code: string }[];
      unmatched: { project_id: string; project_name: string; job_code: string | null }[];
    }>('/xero/projects/match-all', { company_id: companyId });
    return data;
  },

  async createProject(companyId: string, projectId: string, contactId: string, name?: string) {
    const { data } = await axiosInstance.post('/xero/projects/create', {
      company_id: companyId,
      project_id: projectId,
      contact_id: contactId,
      name,
    });
    return data;
  },

  async unlinkProject(companyId: string, projectId: string) {
    const { data } = await axiosInstance.delete('/xero/projects/link', {
      data: { company_id: companyId, project_id: projectId },
    });
    return data;
  },

  async listContacts(companyId: string, search?: string): Promise<{ contacts: XeroContactOption[] }> {
    const { data } = await axiosInstance.get<{ contacts: XeroContactOption[] }>('/xero/contacts', {
      params: { company_id: companyId, search },
    });
    return data;
  },

  async listUsers(companyId: string): Promise<{ users: XeroUserOption[] }> {
    const { data } = await axiosInstance.get<{ users: XeroUserOption[] }>('/xero/users', {
      params: { company_id: companyId },
    });
    return data;
  },

  async setDefaultUser(companyId: string, xeroUserId: string | null) {
    const { data } = await axiosInstance.put('/xero/settings', {
      company_id: companyId,
      default_xero_user_id: xeroUserId,
    });
    return data;
  },

  async pushTime(companyId: string, opts?: { projectId?: string; timeEntryId?: string }) {
    const { data } = await axiosInstance.post<{
      results: XeroTimePushResult[];
      truncated: boolean;
    } & XeroSyncSummary>('/xero/time/push', {
      company_id: companyId,
      project_id: opts?.projectId,
      time_entry_id: opts?.timeEntryId,
    });
    return data;
  },

  async listAudit(companyId: string, limit = 20): Promise<{ logs: XeroAuditEntry[] }> {
    const { data } = await axiosInstance.get<{ logs: XeroAuditEntry[] }>('/xero/audit', {
      params: { company_id: companyId, limit },
    });
    return data;
  },
};
