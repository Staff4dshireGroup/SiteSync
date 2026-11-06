import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { encryptAtRest } from './tokenEncryption';
import {
  onboardingReminderJobEnabled,
  productionConfigProblems,
  pushOnApprovalEnabled,
  readOnlyMode,
  tokenRefreshJobEnabled,
} from './runtimePolicy';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('staging writer switches', () => {
  it('keeps every background writer off unless its flag is true', () => {
    delete process.env.XERO_TOKEN_REFRESH_JOB;
    delete process.env.XERO_PUSH_ON_APPROVAL;
    delete process.env.ONBOARDING_REMINDER_JOB;
    delete process.env.SITESYNC_READ_ONLY;
    process.env.NODE_ENV = 'production';

    assert.equal(tokenRefreshJobEnabled(), false);
    assert.equal(pushOnApprovalEnabled(), false);
    assert.equal(onboardingReminderJobEnabled(), false);

    process.env.XERO_TOKEN_REFRESH_JOB = 'true';
    process.env.XERO_PUSH_ON_APPROVAL = 'true';
    process.env.ONBOARDING_REMINDER_JOB = 'true';
    assert.equal(tokenRefreshJobEnabled(), true);
    assert.equal(pushOnApprovalEnabled(), true);
    assert.equal(onboardingReminderJobEnabled(), true);
  });

  it('forces writers off in read-only mode even when individual flags are true', () => {
    process.env.SITESYNC_READ_ONLY = 'true';
    process.env.XERO_TOKEN_REFRESH_JOB = 'true';
    process.env.XERO_PUSH_ON_APPROVAL = 'true';
    process.env.ONBOARDING_REMINDER_JOB = 'true';
    assert.equal(readOnlyMode(), true);
    assert.equal(tokenRefreshJobEnabled(), false);
    assert.equal(pushOnApprovalEnabled(), false);
    assert.equal(onboardingReminderJobEnabled(), false);
  });

  it('refuses a production boot with a missing database URL or the dev JWT', () => {
    process.env.NODE_ENV = 'production';
    process.env.SITESYNC_READ_ONLY = 'true';
    delete process.env.JWT_SECRET;
    delete process.env.DATABASE_URL;
    const missing = productionConfigProblems().map((problem) => problem.key);
    assert.deepEqual(missing, ['JWT_SECRET', 'DATABASE_URL']);

    process.env.JWT_SECRET = 'dev-secret-change-me';
    process.env.DATABASE_URL = 'postgresql://example';
    assert.deepEqual(
      productionConfigProblems().map((problem) => problem.reason),
      ['dev fallback is not allowed']
    );
  });

  it('requires the Xero encryption key only when production is allowed to write', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-jwt-secret-not-the-dev-value';
    process.env.DATABASE_URL = 'postgresql://example';
    delete process.env.XERO_TOKEN_ENCRYPTION_KEY;
    delete process.env.SITESYNC_READ_ONLY;
    assert.ok(productionConfigProblems().some((problem) => problem.key === 'XERO_TOKEN_ENCRYPTION_KEY'));

    process.env.SITESYNC_READ_ONLY = 'true';
    assert.deepEqual(productionConfigProblems(), []);
  });

  it('does not invent a production encryption key from JWT_SECRET', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.XERO_TOKEN_ENCRYPTION_KEY;
    process.env.JWT_SECRET = 'production-jwt-secret-not-the-dev-value';
    assert.throws(() => encryptAtRest('token'), /XERO_TOKEN_ENCRYPTION_KEY is required in production/);
  });
});
