import { prisma } from '../db';

export type XeroAuditAction =
  | 'connect_started'
  | 'connect_completed'
  | 'connect_denied'
  | 'connect_failed'
  | 'tenant_selected'
  | 'disconnect'
  | 'token_refreshed'
  | 'token_refresh_failed'
  | 'reauth_required'
  | 'invoices_listed'
  | 'invoice_created'
  | 'accounts_listed'
  | 'projects_listed'
  | 'projects_matched'
  | 'project_linked'
  | 'project_created'
  | 'project_unlinked'
  | 'contacts_listed'
  | 'users_listed'
  | 'default_user_set'
  | 'time_pushed'
  | 'time_push_failed';

export async function logXeroAudit(params: {
  companyId?: string | null;
  userId?: string | null;
  action: XeroAuditAction;
  detail?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.xeroAuditLog.create({
      data: {
        companyId: params.companyId ?? undefined,
        userId: params.userId ?? undefined,
        action: params.action,
        detail: params.detail?.slice(0, 8000),
        meta: params.meta as object | undefined,
      },
    });
  } catch (e) {
    console.error('[xero-audit] failed to persist audit log', (e as Error).message);
  }
}
