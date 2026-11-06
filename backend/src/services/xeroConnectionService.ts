import type { XeroConnection, XeroConnectionStatus } from '@prisma/client';
import { prisma } from '../db';
import { encryptAtRest, decryptAtRest } from '../lib/tokenEncryption';
import { logXeroAudit } from '../lib/xeroAudit';
import * as XeroOAuth from './xeroOAuth';
import { accessTokenNeedsRefresh } from './xeroTokenPolicy';

const REFRESH_TOKEN_TTL_DAYS = 60;
const ACCOUNTING_BASE = 'https://api.xero.com/api.xro/2.0';
const PROJECTS_BASE = 'https://api.xero.com/projects.xro/2.0';

export type TokenBundle = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
};

export function encryptTokenBundle(t: TokenBundle): { accessEnc: string; refreshEnc: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + Math.max(60, t.expires_in) * 1000);
  return {
    accessEnc: encryptAtRest(t.access_token),
    refreshEnc: encryptAtRest(t.refresh_token),
    expiresAt,
  };
}

export function decryptRefreshToken(row: XeroConnection): string {
  if (!row.refreshTokenEnc) throw new Error('missing refresh token');
  return decryptAtRest(row.refreshTokenEnc);
}

export function decryptAccessToken(row: XeroConnection): string {
  if (!row.accessTokenEnc) throw new Error('missing access token');
  return decryptAtRest(row.accessTokenEnc);
}

export type RefreshUpdate = {
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  lastRefreshedAt: Date;
  scopes: string | null;
  status: 'active';
};

export type RefreshOutcome =
  | { ok: true; accessToken: string; update: RefreshUpdate }
  | { ok: false; reauth: true; detail: string };

/**
 * Exchange a stored refresh token for a new pair. Does not touch the database.
 * Callers persist `update` or mark the connection reauth_required.
 */
export async function refreshStoredConnection(
  row: { refreshTokenEnc: string | null; scopes: string | null },
  deps: {
    refreshAccessToken: (refreshToken: string) => Promise<XeroOAuth.XeroTokenResponse>;
    decrypt?: (payload: string) => string;
    now?: Date;
  }
): Promise<RefreshOutcome> {
  if (!row.refreshTokenEnc) {
    return { ok: false, reauth: true, detail: 'No refresh token; reconnect Xero' };
  }
  const decrypt = deps.decrypt ?? decryptAtRest;
  let refreshPlain: string;
  try {
    refreshPlain = decrypt(row.refreshTokenEnc);
  } catch {
    return { ok: false, reauth: true, detail: 'decrypt refresh failed' };
  }

  let tokens: XeroOAuth.XeroTokenResponse;
  try {
    tokens = await deps.refreshAccessToken(refreshPlain);
  } catch (e) {
    return { ok: false, reauth: true, detail: (e as Error).message };
  }

  const now = deps.now ?? new Date();
  const expiresAt = new Date(now.getTime() + Math.max(60, tokens.expires_in) * 1000);
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return {
    ok: true,
    accessToken: tokens.access_token,
    update: {
      accessTokenEnc: encryptAtRest(tokens.access_token),
      refreshTokenEnc: encryptAtRest(tokens.refresh_token),
      accessTokenExpiresAt: expiresAt,
      refreshTokenExpiresAt: refreshExpiresAt,
      lastRefreshedAt: now,
      scopes: tokens.scope ?? row.scopes,
      status: 'active',
    },
  };
}

/** Decrypt a still-valid access token, or return null when a refresh is required. */
export function readCachedAccessToken(
  row: { accessTokenEnc: string | null; accessTokenExpiresAt: Date | null },
  now = Date.now()
): string | null {
  if (!row.accessTokenEnc || accessTokenNeedsRefresh(row.accessTokenExpiresAt, now)) return null;
  try {
    return decryptAtRest(row.accessTokenEnc);
  } catch {
    return null;
  }
}

/** Returns a valid access token, refreshing if needed. Company-scoped via row. */
export async function getValidAccessTokenForCompany(companyId: string): Promise<{ accessToken: string; row: XeroConnection }> {
  const row = await prisma.xeroConnection.findUnique({ where: { companyId } });
  if (!row || row.status !== 'active' || !row.xeroTenantId) {
    throw new Error('No active Xero connection for this company');
  }
  const cached = readCachedAccessToken(row);
  if (cached) return { accessToken: cached, row };
  return refreshAndPersistTokens(companyId);
}

async function refreshAndPersistTokens(companyId: string): Promise<{ accessToken: string; row: XeroConnection }> {
  const row = await prisma.xeroConnection.findUnique({ where: { companyId } });
  if (!row) throw new Error('No refresh token; reconnect Xero');

  const outcome = await refreshStoredConnection(row, {
    refreshAccessToken: XeroOAuth.refreshAccessToken,
  });
  if (!outcome.ok) {
    await markReauthRequired(companyId, outcome.detail);
    if (outcome.detail !== 'No refresh token; reconnect Xero' && outcome.detail !== 'decrypt refresh failed') {
      await logXeroAudit({
        companyId,
        action: 'token_refresh_failed',
        detail: outcome.detail,
      });
    }
    const message =
      outcome.detail === 'decrypt refresh failed'
        ? 'Stored tokens invalid; reconnect Xero'
        : outcome.detail.includes('reconnect')
          ? outcome.detail
          : `${outcome.detail}; reconnect Xero`;
    throw new Error(message);
  }

  const updated = await prisma.xeroConnection.update({
    where: { companyId },
    data: outcome.update,
  });

  await logXeroAudit({ companyId, action: 'token_refreshed', detail: 'access token rotated' });

  return { accessToken: outcome.accessToken, row: updated };
}

async function markReauthRequired(companyId: string, detail: string): Promise<void> {
  await prisma.xeroConnection.updateMany({
    where: { companyId },
    data: { status: 'reauth_required' as XeroConnectionStatus },
  });
  await logXeroAudit({ companyId, action: 'reauth_required', detail });
}

export type XeroApiName = 'accounting' | 'projects';

export async function xeroRequest(
  companyId: string,
  opts: {
    api: XeroApiName;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    query?: Record<string, string | undefined>;
    body?: unknown;
    idempotencyKey?: string;
  }
): Promise<unknown> {
  const { accessToken, row } = await getValidAccessTokenForCompany(companyId);
  const base = opts.api === 'projects' ? PROJECTS_BASE : ACCOUNTING_BASE;
  const path = opts.path.startsWith('/') ? opts.path : `/${opts.path}`;
  const u = new URL(opts.path.startsWith('http') ? opts.path : `${base}${path}`);
  if (opts.query) {
    Object.entries(opts.query).forEach(([key, value]) => {
      if (value != null && value !== '') u.searchParams.set(key, value);
    });
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Xero-tenant-id': row.xeroTenantId!,
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey.slice(0, 128);

  const res = await fetch(u.toString(), {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Xero API ${res.status}: ${text.slice(0, 800)}`);
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Tenant-isolated GET to Xero Accounting API */
export async function xeroAccountingGet(
  companyId: string,
  path: string,
  query?: Record<string, string>
): Promise<unknown> {
  return xeroRequest(companyId, { api: 'accounting', method: 'GET', path, query });
}

/** Tenant-isolated POST to Xero Accounting API (JSON body). */
export async function xeroAccountingPost(companyId: string, path: string, body: unknown): Promise<unknown> {
  return xeroRequest(companyId, { api: 'accounting', method: 'POST', path, body });
}

export function scopesIncludeProjects(scopes: string | null | undefined): boolean {
  if (!scopes) return false;
  return scopes.split(/\s+/).includes('projects');
}
