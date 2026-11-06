/**
 * Fail-closed switches for a second API process that shares the live Supabase database.
 * Unset, empty, or any value other than true/1 keeps the switch off.
 * Read-only mode also forces every writer job off.
 */

const DEV_JWT_SECRET = 'dev-secret-change-me';

export function envFlagTrue(name: string): boolean {
  const flag = process.env[name]?.trim().toLowerCase();
  return flag === 'true' || flag === '1';
}

export function readOnlyMode(): boolean {
  return envFlagTrue('SITESYNC_READ_ONLY');
}

export function tokenRefreshJobEnabled(): boolean {
  return envFlagTrue('XERO_TOKEN_REFRESH_JOB') && !readOnlyMode();
}

export function pushOnApprovalEnabled(): boolean {
  return envFlagTrue('XERO_PUSH_ON_APPROVAL') && !readOnlyMode();
}

export function onboardingReminderJobEnabled(): boolean {
  return envFlagTrue('ONBOARDING_REMINDER_JOB') && !readOnlyMode();
}

export type ConfigProblem = { key: string; reason: string };

/** Problems that must stop a production process. Empty outside production. */
export function productionConfigProblems(): ConfigProblem[] {
  if (process.env.NODE_ENV !== 'production') return [];
  const problems: ConfigProblem[] = [];
  const jwt = process.env.JWT_SECRET?.trim() ?? '';
  if (!jwt) {
    problems.push({ key: 'JWT_SECRET', reason: 'missing' });
  } else if (jwt === DEV_JWT_SECRET) {
    problems.push({ key: 'JWT_SECRET', reason: 'dev fallback is not allowed' });
  }
  if (!process.env.DATABASE_URL?.trim()) {
    problems.push({ key: 'DATABASE_URL', reason: 'missing' });
  }
  if (!readOnlyMode()) {
    const encryptionKey = process.env.XERO_TOKEN_ENCRYPTION_KEY?.trim() ?? '';
    if (encryptionKey.length < 32) {
      problems.push({
        key: 'XERO_TOKEN_ENCRYPTION_KEY',
        reason: 'missing or shorter than 32 characters',
      });
    }
  }
  return problems;
}

export function assertProductionConfig(): void {
  const problems = productionConfigProblems();
  if (problems.length === 0) return;
  console.error('Refusing to start. Production configuration is missing or unsafe:');
  for (const problem of problems) {
    console.error(`- ${problem.key}: ${problem.reason}`);
  }
  process.exit(1);
}
