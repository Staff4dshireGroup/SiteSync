import { Router } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthedRequest } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import { prisma } from '../db';
import { encryptAtRest, decryptAtRest } from '../lib/tokenEncryption';
import { assertCompanyAdmin, resolveCompanyId } from '../lib/xeroAccess';
import { logXeroAudit } from '../lib/xeroAudit';
import * as XeroOAuth from '../services/xeroOAuth';
import {
  encryptTokenBundle,
  type TokenBundle,
  xeroAccountingGet,
  xeroAccountingPost,
} from '../services/xeroConnectionService';
import { forgetLinksIfTenantChanged } from '../services/xeroProjectSync';
import { getCompanyXeroSummary } from '../services/xeroTimeSync';
import { registerXeroSyncRoutes } from './xeroSyncRoutes';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const STATE_MAX_AGE_SEC = 600;
const PENDING_TTL_MS = 10 * 60 * 1000;

type OAuthStatePayload = {
  typ: 'xero_oauth';
  companyId: string;
  userId: string;
};

const router = Router();

/** Public OAuth callback (browser redirect from Xero). */
router.get('/oauth/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const err = req.query.error as string | undefined;
  const errDesc = req.query.error_description as string | undefined;

  const redirectDone = (params: Record<string, string>) => {
    const base = process.env.XERO_OAUTH_SUCCESS_REDIRECT?.trim();
    if (base) {
      const u = new URL(base);
      Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
      return res.redirect(u.toString());
    }
    return res
      .status(200)
      .type('html')
      .send(
        '<!DOCTYPE html><html><body><p>Xero connection updated. You can close this window and return to the app.</p></body></html>'
      );
  };

  if (err) {
    await logXeroAudit({ action: 'connect_denied', detail: errDesc || err });
    return redirectDone({ xero_error: errDesc || err });
  }
  if (!code || !state) {
    return res.status(400).json({ error: 'missing code or state' });
  }

  let payload: OAuthStatePayload;
  try {
    const decoded = jwt.verify(state, JWT_SECRET) as OAuthStatePayload & { typ?: string };
    if (decoded.typ !== 'xero_oauth' || !decoded.companyId || !decoded.userId) {
      throw new Error('invalid state payload');
    }
    payload = decoded;
  } catch {
    await logXeroAudit({ action: 'connect_failed', detail: 'invalid state' });
    return res.status(400).json({ error: 'invalid or expired state' });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    await logXeroAudit({ companyId: payload.companyId, userId: payload.userId, action: 'connect_failed', detail: 'user not admin' });
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (user.role === 'admin' && user.companyId !== payload.companyId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (user.role === 'superadmin') {
    const c = await prisma.company.findUnique({ where: { id: payload.companyId } });
    if (!c) return res.status(404).json({ error: 'Company not found' });
  }

  let tokens: XeroOAuth.XeroTokenResponse;
  try {
    tokens = await XeroOAuth.exchangeAuthorizationCode(code);
  } catch (e) {
    const msg = (e as Error).message;
    await logXeroAudit({
      companyId: payload.companyId,
      userId: payload.userId,
      action: 'connect_failed',
      detail: msg,
    });
    return res.status(400).json({ error: 'token exchange failed' });
  }

  let connections: XeroOAuth.XeroConnectionRow[];
  try {
    connections = await XeroOAuth.fetchXeroConnections(tokens.access_token);
  } catch (e) {
    const msg = (e as Error).message;
    await logXeroAudit({
      companyId: payload.companyId,
      userId: payload.userId,
      action: 'connect_failed',
      detail: msg,
    });
    return res.status(400).json({ error: 'failed to list Xero organisations' });
  }

  if (connections.length === 0) {
    await logXeroAudit({ companyId: payload.companyId, userId: payload.userId, action: 'connect_failed', detail: 'no tenants' });
    return res.status(400).json({ error: 'No Xero organisations found for this account' });
  }

  if (connections.length === 1) {
    const c = connections[0];
    const conflict = await prisma.xeroConnection.findFirst({
      where: { xeroTenantId: c.tenantId, NOT: { companyId: payload.companyId } },
    });
    if (conflict) {
      await logXeroAudit({
        companyId: payload.companyId,
        userId: payload.userId,
        action: 'connect_failed',
        detail: 'tenant already linked to another company',
      });
      return res.status(409).json({ error: 'This Xero organisation is already linked to another company' });
    }

    const previous = await prisma.xeroConnection.findUnique({ where: { companyId: payload.companyId } });
    const { accessEnc, refreshEnc, expiresAt } = encryptTokenBundle({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      scope: tokens.scope,
    });
    const refreshExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

    await prisma.xeroConnection.upsert({
      where: { companyId: payload.companyId },
      create: {
        companyId: payload.companyId,
        xeroTenantId: c.tenantId,
        xeroTenantName: c.tenantName,
        xeroConnectionId: c.id,
        accessTokenEnc: accessEnc,
        refreshTokenEnc: refreshEnc,
        accessTokenExpiresAt: expiresAt,
        refreshTokenExpiresAt: refreshExpiresAt,
        scopes: tokens.scope ?? XeroOAuth.getXeroScopes(),
        status: 'active',
        connectedByUserId: payload.userId,
        connectedAt: new Date(),
      },
      update: {
        xeroTenantId: c.tenantId,
        xeroTenantName: c.tenantName,
        xeroConnectionId: c.id,
        accessTokenEnc: accessEnc,
        refreshTokenEnc: refreshEnc,
        accessTokenExpiresAt: expiresAt,
        refreshTokenExpiresAt: refreshExpiresAt,
        scopes: tokens.scope ?? undefined,
        status: 'active',
        connectedByUserId: payload.userId,
        connectedAt: new Date(),
      },
    });

    await forgetLinksIfTenantChanged(payload.companyId, previous?.xeroTenantId, c.tenantId);
    await logXeroAudit({
      companyId: payload.companyId,
      userId: payload.userId,
      action: 'connect_completed',
      meta: { tenantId: c.tenantId },
    });
    return redirectDone({ xero_connected: '1' });
  }

  const bundle = encryptAtRest(
    JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      scope: tokens.scope,
    })
  );

  const tenantsJson = JSON.stringify(
    connections.map((x) => ({ tenantId: x.tenantId, tenantName: x.tenantName, connectionId: x.id }))
  );
  const pending = await prisma.xeroOAuthPending.create({
    data: {
      companyId: payload.companyId,
      userId: payload.userId,
      encryptedTokenBundle: bundle,
      tenantsJson,
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    },
  });

  await logXeroAudit({
    companyId: payload.companyId,
    userId: payload.userId,
    action: 'connect_started',
    detail: 'pending tenant selection',
    meta: { pendingId: pending.id },
  });

  return redirectDone({ xero_pending: pending.id });
});

router.use(authMiddleware);

router.get('/connect/start', async (req: AuthedRequest, res) => {
  try {
    XeroOAuth.getXeroClientConfig();
  } catch {
    return res.status(503).json({ error: 'Xero integration is not configured on the server' });
  }

  const companyId = resolveCompanyId(req, req.query as { company_id?: string });
  if (!companyId) {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!(await assertCompanyAdmin(req, companyId))) {
    return res.status(403).json({ error: 'Only company admins can connect Xero' });
  }

  const state = jwt.sign(
    { typ: 'xero_oauth', companyId, userId: req.userId!,
      exp: Math.floor(Date.now() / 1000) + STATE_MAX_AGE_SEC,
    },
    JWT_SECRET
  );

  const authorization_url = XeroOAuth.buildAuthorizationUrl({ state });

  await logXeroAudit({ companyId, userId: req.userId, action: 'connect_started', detail: 'authorization url issued' });

  res.json({ authorization_url });
});

router.get('/status', async (req: AuthedRequest, res) => {
  const companyId = resolveCompanyId(req, req.query as { company_id?: string });
  if (!companyId) {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!(await assertCompanyAdmin(req, companyId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  /** Multi-org OAuth: user must pick a tenant; surface this so the app can open the picker. */
  const pending = await prisma.xeroOAuthPending.findFirst({
    where: {
      companyId,
      userId: req.userId!,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (pending) {
    return res.json({
      status: 'pending_tenant' as const,
      company_id: companyId,
      xero_connected: false,
      pending_id: pending.id,
    });
  }

  const row = await prisma.xeroConnection.findUnique({ where: { companyId } });
  if (!row) {
    return res.json({
      status: 'disconnected',
      company_id: companyId,
      xero_connected: false,
    });
  }

  const payload =
    row.status === 'active' && row.xeroTenantId
      ? {
          status: 'connected' as const,
          company_id: companyId,
          xero_connected: true,
          xero_tenant_id: row.xeroTenantId,
          xero_tenant_name: row.xeroTenantName,
          connected_at: row.connectedAt?.toISOString(),
          connected_by_user_id: row.connectedByUserId,
          last_refreshed_at: row.lastRefreshedAt?.toISOString(),
          last_synced_at: row.lastSyncedAt?.toISOString(),
        }
      : row.status === 'reauth_required'
        ? {
            status: 'reauth_required' as const,
            company_id: companyId,
            xero_connected: false,
            message: 'Xero authorization expired; connect again.',
          }
        : {
            status: 'disconnected' as const,
            company_id: companyId,
            xero_connected: false,
          };

  const summary = await getCompanyXeroSummary(companyId);
  res.json({ ...payload, ...summary });
});

router.post('/disconnect', async (req: AuthedRequest, res) => {
  const companyId = resolveCompanyId(req, req.body ?? {});
  if (!companyId) {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!(await assertCompanyAdmin(req, companyId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await prisma.xeroOAuthPending.deleteMany({ where: { companyId } });

  await prisma.xeroConnection.upsert({
    where: { companyId },
    create: {
      companyId,
      status: 'disconnected',
    },
    update: {
      accessTokenEnc: null,
      refreshTokenEnc: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      xeroTenantId: null,
      xeroTenantName: null,
      xeroConnectionId: null,
      status: 'disconnected',
    },
  });

  await logXeroAudit({ companyId, userId: req.userId, action: 'disconnect' });

  res.json({ ok: true, status: 'disconnected', company_id: companyId });
});

router.get('/pending/:id', async (req: AuthedRequest, res) => {
  const p = await prisma.xeroOAuthPending.findUnique({ where: { id: req.params.id } });
  if (!p || p.expiresAt < new Date()) {
    return res.status(404).json({ error: 'pending session not found or expired' });
  }
  if (p.userId !== req.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!(await assertCompanyAdmin(req, p.companyId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const tenants = JSON.parse(p.tenantsJson) as { tenantId: string; tenantName: string; connectionId: string }[];
  res.json({ pending_id: p.id, tenants });
});

router.post('/pending/complete', async (req: AuthedRequest, res) => {
  const pendingId = req.body?.pending_id ?? req.body?.pendingId;
  const tenantId = req.body?.tenant_id ?? req.body?.tenantId;
  if (!pendingId || !tenantId) {
    return res.status(400).json({ error: 'pending_id and tenant_id required' });
  }

  const p = await prisma.xeroOAuthPending.findUnique({ where: { id: String(pendingId) } });
  if (!p || p.expiresAt < new Date()) {
    return res.status(404).json({ error: 'pending session not found or expired' });
  }
  if (p.userId !== req.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!(await assertCompanyAdmin(req, p.companyId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const tenants = JSON.parse(p.tenantsJson) as { tenantId: string; tenantName: string; connectionId: string }[];
  const chosen = tenants.find((t) => t.tenantId === tenantId);
  if (!chosen) {
    return res.status(400).json({ error: 'invalid tenant_id' });
  }

  const conflict = await prisma.xeroConnection.findFirst({
    where: { xeroTenantId: chosen.tenantId, NOT: { companyId: p.companyId } },
  });
  if (conflict) {
    return res.status(409).json({ error: 'This Xero organisation is already linked to another company' });
  }

  let raw: { access_token: string; refresh_token: string; expires_in: number; scope?: string };
  try {
    raw = JSON.parse(decryptAtRest(p.encryptedTokenBundle));
  } catch {
    return res.status(400).json({ error: 'invalid pending token bundle' });
  }

  const tokens: TokenBundle = {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_in: raw.expires_in,
    scope: raw.scope,
  };
  const previous = await prisma.xeroConnection.findUnique({ where: { companyId: p.companyId } });
  const { accessEnc, refreshEnc, expiresAt } = encryptTokenBundle(tokens);
  const refreshExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

  await prisma.xeroConnection.upsert({
    where: { companyId: p.companyId },
    create: {
      companyId: p.companyId,
      xeroTenantId: chosen.tenantId,
      xeroTenantName: chosen.tenantName,
      xeroConnectionId: chosen.connectionId,
      accessTokenEnc: accessEnc,
      refreshTokenEnc: refreshEnc,
      accessTokenExpiresAt: expiresAt,
      refreshTokenExpiresAt: refreshExpiresAt,
      scopes: tokens.scope ?? XeroOAuth.getXeroScopes(),
      status: 'active',
      connectedByUserId: p.userId,
      connectedAt: new Date(),
    },
    update: {
      xeroTenantId: chosen.tenantId,
      xeroTenantName: chosen.tenantName,
      xeroConnectionId: chosen.connectionId,
      accessTokenEnc: accessEnc,
      refreshTokenEnc: refreshEnc,
      accessTokenExpiresAt: expiresAt,
      refreshTokenExpiresAt: refreshExpiresAt,
      scopes: tokens.scope ?? undefined,
      status: 'active',
      connectedByUserId: p.userId,
      connectedAt: new Date(),
    },
  });

  await prisma.xeroOAuthPending.delete({ where: { id: p.id } });
  await forgetLinksIfTenantChanged(p.companyId, previous?.xeroTenantId, chosen.tenantId);

  await logXeroAudit({
    companyId: p.companyId,
    userId: p.userId,
    action: 'tenant_selected',
    meta: { tenantId: chosen.tenantId },
  });
  await logXeroAudit({ companyId: p.companyId, userId: p.userId, action: 'connect_completed' });

  res.json({ ok: true, status: 'connected', company_id: p.companyId });
});

function mapXeroInvoiceRow(raw: unknown): {
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
} {
  const x = raw as Record<string, unknown>;
  const contact = x.Contact as { Name?: string } | undefined;
  return {
    id: String(x.InvoiceID ?? ''),
    invoice_number: String(x.InvoiceNumber ?? ''),
    type: String(x.Type ?? ''),
    reference: x.Reference != null && String(x.Reference).trim() !== '' ? String(x.Reference) : null,
    contact_name: contact?.Name ?? null,
    date: x.DateString != null ? String(x.DateString) : null,
    due_date: x.DueDateString != null ? String(x.DueDateString) : null,
    status: String(x.Status ?? ''),
    total: typeof x.Total === 'number' ? x.Total : null,
    amount_due: typeof x.AmountDue === 'number' ? x.AmountDue : null,
    amount_paid: typeof x.AmountPaid === 'number' ? x.AmountPaid : null,
    currency_code: x.CurrencyCode != null ? String(x.CurrencyCode) : null,
  };
}

/** Active accounts (for line item AccountCode). Prefer revenue-style types for sales invoices. */
router.get('/accounts', async (req: AuthedRequest, res) => {
  const companyId = resolveCompanyId(req, req.query as { company_id?: string });
  if (!companyId) {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!(await assertCompanyAdmin(req, companyId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const data = (await xeroAccountingGet(companyId, '/Accounts', {
      where: 'Status=="ACTIVE"',
    })) as { Accounts?: unknown[] };
    const revenueTypes = new Set(['REVENUE', 'OTHERINCOME', 'SALES']);
    const mapped = (data.Accounts ?? []).map((raw) => {
      const a = raw as Record<string, unknown>;
      return {
        code: a.Code != null ? String(a.Code) : '',
        name: a.Name != null ? String(a.Name) : '',
        type: a.Type != null ? String(a.Type) : '',
      };
    });
    const revenueOnly = mapped.filter((a) => a.code && revenueTypes.has(a.type));
    /** If chart uses uncommon types, still offer active accounts so the user can pick a code. */
    const accounts = (revenueOnly.length > 0 ? revenueOnly : mapped.filter((a) => a.code)).slice(0, 80);
    await logXeroAudit({
      companyId,
      userId: req.userId,
      action: 'accounts_listed',
      detail: `count=${accounts.length}`,
    });
    res.json({ accounts });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('No active Xero') || msg.includes('reconnect')) {
      return res.status(400).json({
        error: 'xero_not_connected',
        message: 'Connect Xero in Settings (this company has no active Xero link).',
      });
    }
    await logXeroAudit({ companyId, userId: req.userId, action: 'connect_failed', detail: msg });
    res.status(502).json({ error: 'xero_request_failed', message: msg });
  }
});

/** Create ACCREC invoice in Xero (requires accounting.invoices scope). */
router.post('/invoices', async (req: AuthedRequest, res) => {
  const body = req.body ?? {};
  const companyId = resolveCompanyId(req, body as { company_id?: string; companyId?: string });
  if (!companyId) {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!(await assertCompanyAdmin(req, companyId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const contactId = body.contact_id ?? body.contactId;
  const contactName = body.contact_name ?? body.contactName;
  const hasContactId = contactId != null && String(contactId).trim() !== '';
  const hasName = contactName != null && String(contactName).trim() !== '';
  if (!hasContactId && !hasName) {
    return res.status(400).json({ error: 'contact_id or contact_name required' });
  }

  const lineItemsRaw = body.line_items ?? body.lineItems;
  if (!Array.isArray(lineItemsRaw) || lineItemsRaw.length === 0) {
    return res.status(400).json({ error: 'line_items required (at least one line)' });
  }

  const lineItems: Array<{
    Description: string;
    Quantity: number;
    UnitAmount: number;
    AccountCode: string;
  }> = [];
  for (let i = 0; i < lineItemsRaw.length; i++) {
    const L = lineItemsRaw[i] as Record<string, unknown>;
    const desc = String(L.description ?? L.Description ?? '').trim();
    const qty = Number(L.quantity ?? L.Quantity ?? 1);
    const unit = Number(L.unit_amount ?? L.unitAmount ?? L.UnitAmount);
    const code = String(L.account_code ?? L.accountCode ?? L.AccountCode ?? '').trim();
    if (!desc) {
      return res.status(400).json({ error: `Line ${i + 1}: description required` });
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: `Line ${i + 1}: invalid quantity` });
    }
    if (!Number.isFinite(unit)) {
      return res.status(400).json({ error: `Line ${i + 1}: invalid unit_amount` });
    }
    if (!code) {
      return res.status(400).json({ error: `Line ${i + 1}: account_code required` });
    }
    lineItems.push({
      Description: desc,
      Quantity: qty,
      UnitAmount: unit,
      AccountCode: code,
    });
  }

  const dateStr = (body.date ?? body.Date) as string | undefined;
  const dueStr = (body.due_date ?? body.dueDate) as string | undefined;
  const reference = body.reference != null ? String(body.reference) : undefined;
  const statusRaw = String(body.status ?? body.Status ?? 'DRAFT').toUpperCase();
  const status = ['DRAFT', 'AUTHORISED', 'SUBMITTED'].includes(statusRaw) ? statusRaw : 'DRAFT';

  const today = new Date();
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);
  const date = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : isoDate(today);
  const due =
    dueStr && /^\d{4}-\d{2}-\d{2}$/.test(dueStr)
      ? dueStr
      : isoDate(new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000));

  const contact = hasContactId
    ? { ContactID: String(contactId).trim() }
    : { Name: String(contactName).trim() };

  const invoicePayload = {
    Type: 'ACCREC' as const,
    Contact: contact,
    Date: date,
    DueDate: due,
    ...(reference && reference.trim() ? { Reference: reference.trim() } : {}),
    Status: status,
    LineItems: lineItems,
  };

  try {
    const out = (await xeroAccountingPost(companyId, '/Invoices', {
      Invoices: [invoicePayload],
    })) as { Invoices?: unknown[] };
    const created = (out.Invoices ?? [])[0];
    if (!created) {
      return res.status(502).json({
        error: 'xero_no_invoice_returned',
        message: 'Xero did not return an invoice',
      });
    }
    const mapped = mapXeroInvoiceRow(created);
    await logXeroAudit({
      companyId,
      userId: req.userId,
      action: 'invoice_created',
      detail: mapped.invoice_number || mapped.id,
      meta: { invoice_id: mapped.id },
    });
    res.status(201).json({ invoice: mapped });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('No active Xero') || msg.includes('reconnect')) {
      return res.status(400).json({
        error: 'xero_not_connected',
        message: 'Connect Xero in Settings (this company has no active Xero link).',
      });
    }
    await logXeroAudit({ companyId, userId: req.userId, action: 'connect_failed', detail: msg });
    res.status(502).json({ error: 'xero_request_failed', message: msg });
  }
});

/** List ACCREC invoices from Xero Accounting (requires active connection + accounting.invoices scope). */
router.get('/invoices', async (req: AuthedRequest, res) => {
  const companyId = resolveCompanyId(req, req.query as { company_id?: string });
  if (!companyId) {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!(await assertCompanyAdmin(req, companyId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const statusFilter = (req.query.status as string | undefined)?.trim();
  const page = (req.query.page as string | undefined)?.trim() || '1';
  const query: Record<string, string> = { page };
  if (statusFilter && statusFilter !== 'ALL') {
    query.Status = statusFilter;
  }

  try {
    const data = (await xeroAccountingGet(companyId, '/Invoices', query)) as { Invoices?: unknown[] };
    const invoices = (data.Invoices ?? [])
      .filter((raw) => (raw as Record<string, unknown>).Type === 'ACCREC')
      .map(mapXeroInvoiceRow);
    await prisma.xeroConnection.update({
      where: { companyId },
      data: { lastSyncedAt: new Date() },
    });
    await logXeroAudit({
      companyId,
      userId: req.userId,
      action: 'invoices_listed',
      detail: `count=${invoices.length}`,
    });
    res.json({ invoices, page: Number(page) || 1 });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('No active Xero') || msg.includes('reconnect')) {
      return res.status(400).json({
        error: 'xero_not_connected',
        message: 'Connect Xero in Settings (this company has no active Xero link).',
      });
    }
    await logXeroAudit({ companyId, userId: req.userId, action: 'connect_failed', detail: msg });
    res.status(502).json({ error: 'xero_request_failed', message: msg });
  }
});

router.get('/test/organisation', async (req: AuthedRequest, res) => {
  const companyId = resolveCompanyId(req, req.query as { company_id?: string });
  if (!companyId) {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!(await assertCompanyAdmin(req, companyId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const org = await xeroAccountingGet(companyId, '/Organisation');
    await prisma.xeroConnection.update({
      where: { companyId },
      data: { lastSyncedAt: new Date() },
    });
    res.json({ ok: true, organisation: org });
  } catch (e) {
    const msg = (e as Error).message;
    await logXeroAudit({ companyId, userId: req.userId, action: 'connect_failed', detail: msg });
    res.status(502).json({ error: 'xero_request_failed', message: msg });
  }
});

registerXeroSyncRoutes(router);

export default router;
