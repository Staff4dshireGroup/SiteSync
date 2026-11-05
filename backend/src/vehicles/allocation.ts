import { addDays, isIsoDate } from './dates';

export interface AllocationRow {
  id: string;
  vehicleId: string;
  userId: string;
  projectId: string | null;
  startDate: string;
  endDate: string | null;
  endedAt: string | null;
  assignedByUserId: string;
  assignedAt: string;
  endedByUserId: string | null;
}

export interface AllocationUpdate {
  id: string;
  endDate: string;
  endedAt: string | null;
  endedByUserId: string | null;
}

export class AllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllocationError';
  }
}

export function isActiveAllocation(row: AllocationRow, today: string): boolean {
  if (row.endedAt) return false;
  if (row.startDate > today) return false;
  if (row.endDate && row.endDate < today) return false;
  return true;
}

export function activeAllocations(rows: AllocationRow[], today: string): AllocationRow[] {
  return rows.filter((row) => isActiveAllocation(row, today));
}

function overlaps(row: AllocationRow, startDate: string, endDate: string | null): boolean {
  if (row.endedAt) return false;
  if (row.endDate && row.endDate < startDate) return false;
  if (endDate && endDate < row.startDate) return false;
  return true;
}

export interface NewAllocationInput {
  newId: string;
  vehicleId: string;
  userId: string;
  projectId: string | null;
  startDate: string;
  /** Null means until further notice. */
  endDate: string | null;
  assignedByUserId: string;
  nowIso: string;
}

/**
 * Reassigning closes any overlapping open allocation and appends a new row.
 * Existing rows are kept. At most one allocation is active on a given day.
 */
export function planAllocation(
  rows: AllocationRow[],
  input: NewAllocationInput,
  today: string
): { updates: AllocationUpdate[]; created: AllocationRow } {
  if (!input.userId) throw new AllocationError('user_id is required');
  if (!isIsoDate(input.startDate)) throw new AllocationError('start_date must be YYYY-MM-DD');
  if (input.endDate != null && !isIsoDate(input.endDate)) {
    throw new AllocationError('end_date must be YYYY-MM-DD');
  }
  if (input.endDate && input.endDate < input.startDate) {
    throw new AllocationError('end_date cannot be before start_date');
  }
  if (!isIsoDate(today)) throw new AllocationError('today must be YYYY-MM-DD');

  const updates: AllocationUpdate[] = [];
  for (const row of rows) {
    if (!overlaps(row, input.startDate, input.endDate)) continue;
    const dayBefore = addDays(input.startDate, -1);
    let endDate = dayBefore;
    let endedAt: string | null = null;
    let endedByUserId: string | null = null;
    if (endDate < row.startDate) {
      endDate = row.startDate;
      endedAt = input.nowIso;
      endedByUserId = input.assignedByUserId;
    } else if (input.startDate <= today) {
      endedAt = input.nowIso;
      endedByUserId = input.assignedByUserId;
    }
    if (row.endDate && row.endDate < endDate) endDate = row.endDate;
    updates.push({ id: row.id, endDate, endedAt, endedByUserId });
  }

  const created: AllocationRow = {
    id: input.newId,
    vehicleId: input.vehicleId,
    userId: input.userId,
    projectId: input.projectId,
    startDate: input.startDate,
    endDate: input.endDate,
    endedAt: null,
    assignedByUserId: input.assignedByUserId,
    assignedAt: input.nowIso,
    endedByUserId: null,
  };
  return { updates, created };
}

/** Ends every still-open allocation (active or scheduled) without deleting history. */
export function planUnallocation(
  rows: AllocationRow[],
  input: { endedByUserId: string; nowIso: string },
  today: string
): AllocationUpdate[] {
  if (!isIsoDate(today)) throw new AllocationError('today must be YYYY-MM-DD');
  const open = rows.filter((row) => !row.endedAt && (!row.endDate || row.endDate >= today));
  if (open.length === 0) throw new AllocationError('No active allocation');
  return open.map((row) => ({
    id: row.id,
    endDate: row.endDate && row.endDate < today ? row.endDate : row.startDate > today ? row.startDate : today,
    endedAt: input.nowIso,
    endedByUserId: input.endedByUserId,
  }));
}

export function applyUpdates(rows: AllocationRow[], updates: AllocationUpdate[]): AllocationRow[] {
  const byId = new Map(updates.map((update) => [update.id, update]));
  return rows.map((row) => {
    const update = byId.get(row.id);
    if (!update) return row;
    return {
      ...row,
      endDate: update.endDate,
      endedAt: update.endedAt,
      endedByUserId: update.endedByUserId,
    };
  });
}

export function applyAllocation(rows: AllocationRow[], input: NewAllocationInput, today: string): AllocationRow[] {
  const plan = planAllocation(rows, input, today);
  return [...applyUpdates(rows, plan.updates), plan.created];
}
