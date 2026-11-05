import { daysUntil, formatDayMonth } from './dates';

export const EXPIRY_WARNING_DAYS = 30;

export type ExpiryState = 'ok' | 'due_soon' | 'overdue' | 'unset';

export type ExpiryKey = 'mot' | 'road_tax' | 'insurance' | 'service_date' | 'service_mileage';

export interface ExpiryItem {
  key: ExpiryKey;
  label: string;
  state: ExpiryState;
  due_date?: string;
  days_until?: number;
  message?: string;
}

export interface ExpiryAssessment {
  items: ExpiryItem[];
  /** Worst of the dated compliance items and service mileage. */
  worst: ExpiryState;
  /** True when something is due within 30 days or overdue. Includes service, which is a warning only. */
  has_warning: boolean;
}

export interface ExpiryInput {
  motDue: string | null;
  roadTaxDue: string | null;
  insuranceExpiry: string | null;
  serviceDueDate: string | null;
  serviceDueMileage: number | null;
  currentMileage: number | null;
}

const RANK: Record<ExpiryState, number> = {
  unset: 0,
  ok: 1,
  due_soon: 2,
  overdue: 3,
};

/**
 * Date on the due day or earlier is overdue.
 * 1–30 days ahead is a warning. Further out is ok. Missing dates are unset.
 */
export function dateExpiryState(due: string | null, today: string): { state: ExpiryState; days_until?: number } {
  if (!due) return { state: 'unset' };
  const days = daysUntil(due, today);
  if (days <= 0) return { state: 'overdue', days_until: days };
  if (days <= EXPIRY_WARNING_DAYS) return { state: 'due_soon', days_until: days };
  return { state: 'ok', days_until: days };
}

function dateItem(key: ExpiryKey, label: string, due: string | null, today: string): ExpiryItem {
  const { state, days_until } = dateExpiryState(due, today);
  const item: ExpiryItem = { key, label, state };
  if (due) item.due_date = due;
  if (days_until != null) item.days_until = days_until;
  if (state === 'overdue' && due) item.message = `${label} expired ${formatDayMonth(due)}`;
  else if (state === 'due_soon' && due && days_until != null) {
    item.message = `${label} due ${formatDayMonth(due)} (${days_until} day${days_until === 1 ? '' : 's'})`;
  }
  return item;
}

function mileageItem(dueMileage: number | null, currentMileage: number | null): ExpiryItem {
  if (dueMileage == null) return { key: 'service_mileage', label: 'Service mileage', state: 'unset' };
  if (currentMileage == null) return { key: 'service_mileage', label: 'Service mileage', state: 'unset' };
  if (currentMileage >= dueMileage) {
    return {
      key: 'service_mileage',
      label: 'Service mileage',
      state: 'overdue',
      message: `Service mileage reached (${currentMileage} / ${dueMileage})`,
    };
  }
  return { key: 'service_mileage', label: 'Service mileage', state: 'ok' };
}

export function assessExpiry(input: ExpiryInput, today: string): ExpiryAssessment {
  const items: ExpiryItem[] = [
    dateItem('mot', 'MOT', input.motDue, today),
    dateItem('road_tax', 'Road tax', input.roadTaxDue, today),
    dateItem('insurance', 'Insurance', input.insuranceExpiry, today),
    dateItem('service_date', 'Service', input.serviceDueDate, today),
    mileageItem(input.serviceDueMileage, input.currentMileage),
  ];
  let worst: ExpiryState = 'unset';
  for (const item of items) {
    if (RANK[item.state] > RANK[worst]) worst = item.state;
  }
  const has_warning = items.some((item) => item.state === 'due_soon' || item.state === 'overdue');
  return { items, worst, has_warning };
}
