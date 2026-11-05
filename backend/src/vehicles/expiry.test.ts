import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessExpiry, dateExpiryState } from './expiry';

const today = '2026-11-05';

test('expiry today or earlier is overdue, 1–30 days is a warning, 31 is ok', () => {
  assert.equal(dateExpiryState('2026-11-04', today).state, 'overdue');
  assert.equal(dateExpiryState('2026-11-04', today).days_until, -1);
  assert.equal(dateExpiryState('2026-11-05', today).state, 'overdue');
  assert.equal(dateExpiryState('2026-11-05', today).days_until, 0);
  assert.equal(dateExpiryState('2026-11-06', today).state, 'due_soon');
  assert.equal(dateExpiryState('2026-11-06', today).days_until, 1);
  assert.equal(dateExpiryState('2026-12-05', today).state, 'due_soon');
  assert.equal(dateExpiryState('2026-12-05', today).days_until, 30);
  assert.equal(dateExpiryState('2026-12-06', today).state, 'ok');
  assert.equal(dateExpiryState('2026-12-06', today).days_until, 31);
  assert.equal(dateExpiryState(null, today).state, 'unset');
});

test('service date and mileage are warnings, including when overdue', () => {
  const assessment = assessExpiry(
    {
      motDue: '2027-06-01',
      roadTaxDue: '2027-06-01',
      insuranceExpiry: '2027-06-01',
      serviceDueDate: '2026-11-01',
      serviceDueMileage: 10000,
      currentMileage: 10000,
    },
    today
  );
  const service = assessment.items.find((item) => item.key === 'service_date');
  const mileage = assessment.items.find((item) => item.key === 'service_mileage');
  assert.equal(service?.state, 'overdue');
  assert.equal(mileage?.state, 'overdue');
  assert.equal(assessment.has_warning, true);
  assert.equal(assessment.worst, 'overdue');
});

test('a date 30 days out is a warning and a date 31 days out is clear', () => {
  const dueSoon = assessExpiry(
    {
      motDue: '2026-12-05',
      roadTaxDue: null,
      insuranceExpiry: null,
      serviceDueDate: null,
      serviceDueMileage: null,
      currentMileage: null,
    },
    today
  );
  assert.equal(dueSoon.items[0]?.message, 'MOT due 5 Dec (30 days)');
  assert.equal(dueSoon.has_warning, true);

  const clear = assessExpiry(
    {
      motDue: '2026-12-06',
      roadTaxDue: '2027-01-01',
      insuranceExpiry: '2027-01-01',
      serviceDueDate: '2027-01-01',
      serviceDueMileage: 20000,
      currentMileage: 1000,
    },
    today
  );
  assert.equal(clear.has_warning, false);
  assert.equal(clear.worst, 'ok');
});
