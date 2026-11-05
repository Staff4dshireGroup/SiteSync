import { formatDayMonth } from './dates';
import { dateExpiryState } from './expiry';

export type BlockCode =
  | 'mot_expired'
  | 'road_tax_expired'
  | 'insurance_expired'
  | 'status_not_active'
  | 'open_defect'
  | 'check_missing'
  | 'check_failed';

export interface BlockReason {
  code: BlockCode;
  message: string;
}

export type BlockPurpose = 'allocate' | 'use';

export type VehicleOperationalStatus = 'active' | 'off_road' | 'sold';

export interface OpenDefectInput {
  id: string;
}

export interface TodayCheckInput {
  result: 'pass' | 'fail';
  /** Set when this check opened an unsafe defect. */
  unsafe?: boolean;
  /** True once an admin has resolved that defect. Resolving clears the check failure as well. */
  resolved?: boolean;
}

export interface BlockInput {
  status: VehicleOperationalStatus;
  motDue: string | null;
  roadTaxDue: string | null;
  insuranceExpiry: string | null;
  openDefects: OpenDefectInput[];
  /** Latest start-of-day check for today, if one was submitted. */
  todayCheck: TodayCheckInput | null;
  purpose: BlockPurpose;
  today: string;
}

/**
 * Hard blocks that stop a vehicle being allocated or sent out.
 * Service due dates stay warnings (see assessExpiry) and are not included.
 * A missing or failed start-of-day check blocks use for the day only.
 * Allocation can happen before the driver submits today's check.
 */
export function vehicleBlockReasons(input: BlockInput): BlockReason[] {
  const reasons: BlockReason[] = [];

  const mot = dateExpiryState(input.motDue, input.today);
  if (mot.state === 'overdue' && input.motDue) {
    reasons.push({ code: 'mot_expired', message: `Blocked: MOT expired ${formatDayMonth(input.motDue)}` });
  }
  const tax = dateExpiryState(input.roadTaxDue, input.today);
  if (tax.state === 'overdue' && input.roadTaxDue) {
    reasons.push({
      code: 'road_tax_expired',
      message: `Blocked: Road tax expired ${formatDayMonth(input.roadTaxDue)}`,
    });
  }
  const insurance = dateExpiryState(input.insuranceExpiry, input.today);
  if (insurance.state === 'overdue' && input.insuranceExpiry) {
    reasons.push({
      code: 'insurance_expired',
      message: `Blocked: Insurance expired ${formatDayMonth(input.insuranceExpiry)}`,
    });
  }

  if (input.status !== 'active') {
    reasons.push({
      code: 'status_not_active',
      message: input.status === 'off_road' ? 'Blocked: Off road' : 'Blocked: Sold',
    });
  }

  if (input.openDefects.length > 0) {
    reasons.push({ code: 'open_defect', message: 'Blocked: Unsafe defect open' });
  }

  if (input.purpose === 'use') {
    const failedCheckCleared = input.todayCheck?.unsafe && input.todayCheck.resolved;
    if (!input.todayCheck) {
      reasons.push({ code: 'check_missing', message: 'Blocked: Start-of-day check missing' });
    } else if (input.todayCheck.result === 'fail' && !failedCheckCleared) {
      reasons.push({ code: 'check_failed', message: 'Blocked: Start-of-day check failed' });
    }
  }

  return reasons;
}

export function blockedResponse(reasons: BlockReason[]): { error: string; block_reasons: BlockReason[] } | null {
  if (reasons.length === 0) return null;
  return { error: 'Vehicle blocked', block_reasons: reasons };
}
