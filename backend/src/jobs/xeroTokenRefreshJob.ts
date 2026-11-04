import { prisma } from '../db';
import { getValidAccessTokenForCompany } from '../services/xeroConnectionService';
import { connectionsDueForRefresh, tokenRefreshJobEnabled } from '../services/xeroTokenPolicy';

/** Proactively refresh access tokens before expiry (runs in-process). */
export function startXeroTokenRefreshJob(): void {
  if (!tokenRefreshJobEnabled()) {
    return;
  }
  const intervalMs = Number(process.env.XERO_TOKEN_REFRESH_INTERVAL_MS) || 60 * 60 * 1000;
  const timer = setInterval(() => {
    void runXeroTokenRefreshOnce();
  }, intervalMs);
  timer.unref?.();
}

export async function runXeroTokenRefreshOnce(): Promise<void> {
  const rows = await prisma.xeroConnection.findMany({
    where: { status: 'active', xeroTenantId: { not: null } },
    select: { companyId: true, accessTokenExpiresAt: true },
  });
  for (const row of connectionsDueForRefresh(rows)) {
    try {
      await getValidAccessTokenForCompany(row.companyId);
    } catch {
      // xeroConnectionService marks reauth_required and logs audit
    }
  }
}
