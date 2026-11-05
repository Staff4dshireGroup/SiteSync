import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AllocationError,
  activeAllocations,
  applyAllocation,
  applyUpdates,
  planUnallocation,
  type AllocationRow,
} from './allocation';

const today = '2026-11-05';
const now = '2026-11-05T08:00:00.000Z';

function allocate(
  rows: AllocationRow[],
  partial: { id: string; userId: string; startDate: string; endDate?: string | null }
): AllocationRow[] {
  return applyAllocation(
    rows,
    {
      newId: partial.id,
      vehicleId: 'veh-1',
      userId: partial.userId,
      projectId: null,
      startDate: partial.startDate,
      endDate: partial.endDate === undefined ? null : partial.endDate,
      assignedByUserId: 'admin-1',
      nowIso: now,
    },
    today
  );
}

test('a vehicle has a single active allocation and keeps history when reassigned', () => {
  const first = allocate([], { id: 'alloc-1', userId: 'staff-a', startDate: '2026-11-01' });
  assert.equal(first.length, 1);
  assert.deepEqual(activeAllocations(first, today).map((row) => row.userId), ['staff-a']);
  assert.equal(first[0]?.endDate, null);

  const second = allocate(first, { id: 'alloc-2', userId: 'staff-b', startDate: today });
  assert.equal(second.length, 2);
  assert.deepEqual(
    second.map((row) => row.id),
    ['alloc-1', 'alloc-2']
  );
  const previous = second.find((row) => row.id === 'alloc-1');
  const current = second.find((row) => row.id === 'alloc-2');
  assert.equal(previous?.endedAt, now);
  assert.equal(previous?.endDate, '2026-11-04');
  assert.equal(previous?.endedByUserId, 'admin-1');
  assert.equal(current?.endedAt, null);
  assert.equal(current?.endDate, null);
  assert.deepEqual(activeAllocations(second, today).map((row) => row.id), ['alloc-2']);
});

test('reassigning on the same day the previous allocation started still keeps that row', () => {
  const first = allocate([], { id: 'alloc-1', userId: 'staff-a', startDate: today });
  const second = allocate(first, { id: 'alloc-2', userId: 'staff-b', startDate: today });
  assert.equal(second.length, 2);
  assert.equal(second[0]?.endedAt, now);
  assert.deepEqual(activeAllocations(second, today).map((row) => row.userId), ['staff-b']);
});

test('a future reassignment leaves the current allocation active until the day before', () => {
  const first = allocate([], { id: 'alloc-1', userId: 'staff-a', startDate: '2026-11-01' });
  const scheduled = allocate(first, { id: 'alloc-2', userId: 'staff-b', startDate: '2026-11-10' });
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[0]?.endedAt, null);
  assert.equal(scheduled[0]?.endDate, '2026-11-09');
  assert.deepEqual(activeAllocations(scheduled, today).map((row) => row.id), ['alloc-1']);
  assert.deepEqual(activeAllocations(scheduled, '2026-11-10').map((row) => row.id), ['alloc-2']);
});

test('until further notice stays open, and a fixed end date drops off after that day', () => {
  const openEnded = allocate([], { id: 'alloc-1', userId: 'staff-a', startDate: '2026-11-01', endDate: null });
  assert.equal(openEnded[0]?.endDate, null);
  assert.equal(activeAllocations(openEnded, '2027-01-01').length, 1);

  const fixed = allocate([], { id: 'alloc-2', userId: 'staff-a', startDate: '2026-11-01', endDate: '2026-11-05' });
  assert.equal(activeAllocations(fixed, '2026-11-05').length, 1);
  assert.equal(activeAllocations(fixed, '2026-11-06').length, 0);
});

test('unallocation ends the current row and keeps it in history', () => {
  const rows = allocate([], { id: 'alloc-1', userId: 'staff-a', startDate: '2026-11-01' });
  const updates = planUnallocation(rows, { endedByUserId: 'admin-1', nowIso: now }, today);
  const ended = applyUpdates(rows, updates);
  assert.equal(ended.length, 1);
  assert.equal(ended[0]?.id, 'alloc-1');
  assert.equal(ended[0]?.endedAt, now);
  assert.equal(ended[0]?.endDate, today);
  assert.equal(ended[0]?.endedByUserId, 'admin-1');
  assert.equal(activeAllocations(ended, today).length, 0);
});

test('end date before start date is rejected and an empty unallocation fails', () => {
  assert.throws(
    () => allocate([], { id: 'alloc-1', userId: 'staff-a', startDate: '2026-11-10', endDate: '2026-11-01' }),
    AllocationError
  );
  assert.throws(() => planUnallocation([], { endedByUserId: 'admin-1', nowIso: now }, today), /No active allocation/);
});
