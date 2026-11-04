/**
 * Xero OAuth 2.0 + Identity API helpers. All HTTP calls from backend only.
 */

const AUTH = 'https://login.xero.com/identity/connect/authorize';
const TOKEN = 'https://identity.xero.com/connect/token';
export const CONNECTIONS_URL = 'https://api.xero.com/connections';

/**
 * Default scopes for new Xero OAuth apps (created on/after 2 Mar 2026): granular only.
 * Broad scopes (accounting.settings, accounting.transactions, accounting.contacts) are rejected
 * for those apps — see https://developer.xero.com/faq/granular-scopes
 *
 * Override with env `XERO_SCOPES` (space-separated) e.g. legacy broad scopes for old apps.
 */
/** Post–Mar 2026 apps: use granular resource scopes (see https://developer.xero.com/faq/granular-scopes). */
const XERO_SCOPES_GRANULAR = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'accounting.settings.read',
  'accounting.invoices',
  'accounting.contacts.read',
  // Projects API is not part of the March 2026 accounting granular-scope split.
  'projects',
].join(' ');

export function getXeroScopes(): string {
  const fromEnv = process.env.XERO_SCOPES?.trim();
  return fromEnv || XERO_SCOPES_GRANULAR;
}

/** @deprecated Use getXeroScopes() — value matches env/default at process start */
export const XERO_SCOPES = getXeroScopes();

export function getXeroClientConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.XERO_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.XERO_CLIENT_SECRET?.trim() ?? '';
  const redirectUri = process.env.XERO_REDIRECT_URI?.trim() ?? '';
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Xero is not configured (XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI)');
  }
  return { clientId, clientSecret, redirectUri };
}

export function buildAuthorizationUrl(params: { state: string }): string {
  const { clientId, redirectUri } = getXeroClientConfig();
  const u = new URL(AUTH);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', getXeroScopes());
  u.searchParams.set('state', params.state);
  return u.toString();
}

export type XeroTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
};

export async function exchangeAuthorizationCode(code: string): Promise<XeroTokenResponse> {
  const { clientId, clientSecret, redirectUri } = getXeroClientConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body,
  });
  const json = (await res.json()) as XeroTokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `token exchange failed (${res.status})`);
  }
  return json;
}

export async function refreshAccessToken(refreshToken: string): Promise<XeroTokenResponse> {
  const { clientId, clientSecret } = getXeroClientConfig();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body,
  });
  const json = (await res.json()) as XeroTokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `token refresh failed (${res.status})`);
  }
  return json;
}

export type XeroConnectionRow = {
  id: string;
  tenantId: string;
  tenantType: string;
  tenantName: string;
};

export async function fetchXeroConnections(accessToken: string): Promise<XeroConnectionRow[]> {
  const res = await fetch(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`connections failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as XeroConnectionRow[];
  return Array.isArray(data) ? data : [];
}
