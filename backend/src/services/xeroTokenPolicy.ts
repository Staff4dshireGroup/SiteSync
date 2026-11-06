import { tokenRefreshJobEnabled as tokenRefreshAllowed } from '../lib/runtimePolicy';

/** How early to treat an access token as expired (clock skew + in-flight requests). */
export const ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000;

/** Background job refreshes anything expiring inside this window. */
export const TOKEN_REFRESH_HORIZON_MS = 15 * 60 * 1000;

/** On only when XERO_TOKEN_REFRESH_JOB is true and the process is not read-only. */
export function tokenRefreshJobEnabled(): boolean {
  return tokenRefreshAllowed();
}

export function accessTokenNeedsRefresh(
  expiresAt: Date | null | undefined,
  now = Date.now(),
  skewMs = ACCESS_TOKEN_REFRESH_SKEW_MS
): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() <= now + skewMs;
}

export function connectionsDueForRefresh<T extends { accessTokenExpiresAt: Date | null }>(
  rows: T[],
  now = Date.now(),
  horizonMs = TOKEN_REFRESH_HORIZON_MS
): T[] {
  const horizon = now + horizonMs;
  return rows.filter((row) => (row.accessTokenExpiresAt?.getTime() ?? 0) <= horizon);
}
