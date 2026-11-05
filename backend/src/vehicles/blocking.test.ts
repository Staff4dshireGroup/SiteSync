import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockedResponse, vehicleBlockReasons, type BlockInput } from './blocking';
import { assessExpiry } from './expiry';

const today = '2026-11-05';

function input(overrides: Partial<BlockInput> = {}): BlockInput {
  return {
    status: 'active',
    motDue: '2027-06-01',
    roadTaxDue: '2027-06-01',
    insuranceExpiry: '2027-06-01',
    openDefects: [],
    todayCheck: { result: 'pass' },
    purpose: 'allocate',
    today,
    ...overrides,
  };
}

test('MOT expired yesterday or today blocks allocation and use', () => {
  for (const motDue of ['2026-11-02', '2026-11-05']) {
    const allocate = vehicleBlockReasons(input({ motDue, purpose: 'allocate' }));
    const use = vehicleBlockReasons(input({ motDue, purpose: 'use' }));
    assert.equal(allocate.length, 1);
    assert.equal(allocate[0]?.code, 'mot_expired');
    assert.equal(allocate[0]?.message, `Blocked: MOT expired ${motDue === '2026-11-02' ? '2 Nov' : '5 Nov'}`);
    assert.deepEqual(use.map((reason) => reason.code), ['mot_expired']);
  }
});

test('road tax expiry blocks on its own', () => {
  const reasons = vehicleBlockReasons(input({ roadTaxDue: '2026-10-01', purpose: 'use' }));
  assert.deepEqual(reasons.map((reason) => reason.code), ['road_tax_expired']);
  assert.equal(reasons[0]?.message, 'Blocked: Road tax expired 1 Oct');
});

test('insurance expiry blocks on its own', () => {
  const reasons = vehicleBlockReasons(input({ insuranceExpiry: '2026-11-05' }));
  assert.deepEqual(reasons.map((reason) => reason.code), ['insurance_expired']);
  assert.equal(reasons[0]?.message, 'Blocked: Insurance expired 5 Nov');
});

test('dates inside the 30-day window are warnings and do not block', () => {
  const motDue = '2026-12-05';
  assert.equal(vehicleBlockReasons(input({ motDue, purpose: 'use' })).length, 0);
  const assessment = assessExpiry(
    {
      motDue,
      roadTaxDue: '2026-11-20',
      insuranceExpiry: '2026-12-01',
      serviceDueDate: '2026-11-01',
      serviceDueMileage: null,
      currentMileage: null,
    },
    today
  );
  assert.equal(assessment.has_warning, true);
  assert.equal(assessment.items.find((item) => item.key === 'service_date')?.state, 'overdue');
  assert.equal(
    vehicleBlockReasons(
      input({
        motDue,
        roadTaxDue: '2026-11-20',
        insuranceExpiry: '2026-12-01',
        purpose: 'use',
      })
    ).length,
    0
  );
});

test('off road and sold status block', () => {
  assert.equal(vehicleBlockReasons(input({ status: 'off_road' }))[0]?.message, 'Blocked: Off road');
  assert.equal(vehicleBlockReasons(input({ status: 'sold', purpose: 'use' }))[0]?.message, 'Blocked: Sold');
});

test('an open unsafe defect blocks until it is resolved', () => {
  const open = vehicleBlockReasons(input({ openDefects: [{ id: 'def-1' }], purpose: 'use' }));
  assert.deepEqual(open.map((reason) => reason.code), ['open_defect']);
  assert.equal(open[0]?.message, 'Blocked: Unsafe defect open');

  const resolved = vehicleBlockReasons(input({ openDefects: [], purpose: 'use' }));
  assert.equal(resolved.length, 0);
});

test('a missing or failed start-of-day check blocks use but not allocation', () => {
  const missingUse = vehicleBlockReasons(input({ purpose: 'use', todayCheck: null }));
  const missingAllocate = vehicleBlockReasons(input({ purpose: 'allocate', todayCheck: null }));
  assert.deepEqual(missingUse.map((reason) => reason.code), ['check_missing']);
  assert.equal(missingUse[0]?.message, 'Blocked: Start-of-day check missing');
  assert.equal(missingAllocate.length, 0);

  const failedUse = vehicleBlockReasons(input({ purpose: 'use', todayCheck: { result: 'fail' } }));
  const failedAllocate = vehicleBlockReasons(input({ purpose: 'allocate', todayCheck: { result: 'fail' } }));
  assert.deepEqual(failedUse.map((reason) => reason.code), ['check_failed']);
  assert.equal(failedUse[0]?.message, 'Blocked: Start-of-day check failed');
  assert.equal(failedAllocate.length, 0);
});

test('resolving an unsafe defect clears that block, including the failed check that reported it', () => {
  const open = vehicleBlockReasons(
    input({
      purpose: 'use',
      openDefects: [{ id: 'def-1' }],
      todayCheck: { result: 'fail', unsafe: true, resolved: false },
    })
  );
  assert.ok(open.some((reason) => reason.code === 'open_defect'));
  assert.ok(open.some((reason) => reason.code === 'check_failed'));

  const resolved = vehicleBlockReasons(
    input({
      purpose: 'use',
      openDefects: [],
      todayCheck: { result: 'fail', unsafe: true, resolved: true },
    })
  );
  assert.equal(resolved.length, 0);
});

test('blockedResponse is the 409 body the routes return', () => {
  assert.equal(blockedResponse([]), null);
  const reasons = vehicleBlockReasons(input({ status: 'off_road' }));
  assert.deepEqual(blockedResponse(reasons), { error: 'Vehicle blocked', block_reasons: reasons });
});
