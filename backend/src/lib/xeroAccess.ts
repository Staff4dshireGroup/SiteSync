import type { Response } from 'express';
import type { AuthedRequest } from '../middleware/auth';
import { effectiveRole } from '../middleware/auth';
import { prisma } from '../db';

export function resolveCompanyId(
  req: AuthedRequest,
  queryOrBody: { company_id?: string; companyId?: string }
): string | null {
  const raw = queryOrBody.company_id ?? queryOrBody.companyId;
  if (req.userRole === 'superadmin') {
    return raw ? String(raw) : null;
  }
  return req.companyId ?? null;
}

export async function assertCompanyAdmin(req: AuthedRequest, companyId: string): Promise<boolean> {
  if (req.userRole === 'superadmin') {
    const c = await prisma.company.findUnique({ where: { id: companyId } });
    return !!c;
  }
  if (effectiveRole(req) !== 'admin') return false;
  return req.companyId === companyId;
}

export function sendXeroError(res: Response, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  if (
    msg.includes('No active Xero') ||
    msg.includes('reconnect Xero') ||
    msg.includes('Stored tokens invalid')
  ) {
    res.status(400).json({
      error: 'xero_not_connected',
      message: 'Connect Xero in Settings (this company has no active Xero link).',
    });
    return;
  }
  res.status(502).json({ error: 'xero_request_failed', message: msg });
}
