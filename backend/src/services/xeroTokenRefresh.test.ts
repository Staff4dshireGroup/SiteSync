import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { decryptAtRest, encryptAtRest } from '../lib/tokenEncryption';
import {
  readCachedAccessToken,
  refreshStoredConnection,
} from './xeroConnectionService';
import { refreshAccessToken } from './xeroOAuth';
import {
  accessTokenNeedsRefresh,
  connectionsDueForRefresh,
  TOKEN_REFRESH_HORIZON_MS,
  tokenRefreshJobEnabled,
} from './xeroTokenPolicy';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('access token refresh policy', () => {
  it('refreshes when the token is missing, due, or inside the skew window', () => {
    const now = Date.parse('2026-11-04T12:00:00.000Z');
    assert.equal(accessTokenNeedsRefresh(null, now), true);
    assert.equal(accessTokenNeedsRefresh(new Date(now + 60_000), now), true);
    assert.equal(accessTokenNeedsRefresh(new Date(now + 10 * 60_000), now), false);
  });

  it('selects connections the background job should refresh', () => {
    const now = Date.parse('2026-11-04T12:00:00.000Z');
    const due = connectionsDueForRefresh(
      [
        { companyId: 'soon', accessTokenExpiresAt: new Date(now + 5 * 60_000) },
        { companyId: 'later', accessTokenExpiresAt: new Date(now + TOKEN_REFRESH_HORIZON_MS + 60_000) },
        { companyId: 'missing', accessTokenExpiresAt: null },
      ],
      now
    );
    assert.deepEqual(
      due.map((row) => row.companyId),
      ['soon', 'missing']
    );
  });

  it('stays off unless explicitly enabled, including in production and read-only mode', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.XERO_TOKEN_REFRESH_JOB;
    delete process.env.SITESYNC_READ_ONLY;
    assert.equal(tokenRefreshJobEnabled(), false);
    process.env.XERO_TOKEN_REFRESH_JOB = 'false';
    assert.equal(tokenRefreshJobEnabled(), false);
    process.env.XERO_TOKEN_REFRESH_JOB = 'true';
    assert.equal(tokenRefreshJobEnabled(), true);
    process.env.SITESYNC_READ_ONLY = 'true';
    assert.equal(tokenRefreshJobEnabled(), false);
  });
});

describe('stored token refresh', () => {
  it('keeps a cached access token when it is still valid', () => {
    process.env.XERO_TOKEN_ENCRYPTION_KEY = 'test-key-that-is-long-enough-for-xero';
    const now = Date.now();
    const token = readCachedAccessToken(
      {
        accessTokenEnc: encryptAtRest('still-valid'),
        accessTokenExpiresAt: new Date(now + 30 * 60_000),
      },
      now
    );
    assert.equal(token, 'still-valid');

    const expired = readCachedAccessToken(
      {
        accessTokenEnc: encryptAtRest('old'),
        accessTokenExpiresAt: new Date(now - 1000),
      },
      now
    );
    assert.equal(expired, null);
  });

  it('encrypts the rotated tokens and extends expiry from the Xero response', async () => {
    process.env.XERO_TOKEN_ENCRYPTION_KEY = 'test-key-that-is-long-enough-for-xero';
    const now = new Date('2026-11-04T12:00:00.000Z');
    const outcome = await refreshStoredConnection(
      { refreshTokenEnc: encryptAtRest('refresh-plain'), scopes: 'projects' },
      {
        now,
        decrypt: decryptAtRest,
        refreshAccessToken: async (refreshToken) => {
          assert.equal(refreshToken, 'refresh-plain');
          return {
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 1800,
            token_type: 'Bearer',
            scope: 'openid projects',
          };
        },
      }
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.accessToken, 'new-access');
    assert.equal(decryptAtRest(outcome.update.accessTokenEnc), 'new-access');
    assert.equal(decryptAtRest(outcome.update.refreshTokenEnc), 'new-refresh');
    assert.equal(outcome.update.accessTokenExpiresAt.toISOString(), new Date(now.getTime() + 1800 * 1000).toISOString());
    assert.equal(outcome.update.status, 'active');
    assert.equal(outcome.update.scopes, 'openid projects');
    assert.ok(outcome.update.refreshTokenExpiresAt.getTime() > now.getTime() + 50 * 24 * 60 * 60 * 1000);
  });

  it('asks for reauthorisation when the refresh token is missing, corrupt, or rejected', async () => {
    process.env.XERO_TOKEN_ENCRYPTION_KEY = 'test-key-that-is-long-enough-for-xero';
    const missing = await refreshStoredConnection(
      { refreshTokenEnc: null, scopes: null },
      { refreshAccessToken: async () => { throw new Error('should not be called'); } }
    );
    assert.deepEqual(missing, { ok: false, reauth: true, detail: 'No refresh token; reconnect Xero' });

    const corrupt = await refreshStoredConnection(
      { refreshTokenEnc: 'not-a-real-payload', scopes: null },
      { refreshAccessToken: async () => { throw new Error('should not be called'); } }
    );
    assert.equal(corrupt.ok, false);
    if (!corrupt.ok) assert.equal(corrupt.detail, 'decrypt refresh failed');

    const rejected = await refreshStoredConnection(
      { refreshTokenEnc: encryptAtRest('refresh-plain'), scopes: 'projects' },
      { refreshAccessToken: async () => { throw new Error('invalid_grant'); } }
    );
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.detail, 'invalid_grant');
  });

  it('posts a refresh_token grant and surfaces Xero error descriptions', async () => {
    process.env.XERO_CLIENT_ID = 'client-id';
    process.env.XERO_CLIENT_SECRET = 'client-secret';
    process.env.XERO_REDIRECT_URI = 'http://localhost:3001/api/xero/oauth/callback';

    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://identity.xero.com/connect/token');
      const body = init?.body as URLSearchParams;
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('refresh_token'), 'refresh-plain');
      const headers = init?.headers as Record<string, string>;
      assert.match(headers.Authorization, /^Basic /);
      return new Response(
        JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 1800, token_type: 'Bearer' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };
    const ok = await refreshAccessToken('refresh-plain');
    assert.equal(ok.access_token, 'a');
    assert.equal(ok.refresh_token, 'r');

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'token expired' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    await assert.rejects(() => refreshAccessToken('refresh-plain'), /token expired/);
  });
});
