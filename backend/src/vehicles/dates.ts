const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Calendar day in Europe/London as YYYY-MM-DD. */
export function londonToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error('Could not resolve London calendar day');
  }
  return `${year}-${month}-${day}`;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

export function addDays(isoDate: string, days: number): string {
  if (!isIsoDate(isoDate)) throw new Error(`Invalid date: ${isoDate}`);
  const [year, month, day] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Whole calendar days from today until due. Negative when due is in the past. */
export function daysUntil(due: string, today: string): number {
  if (!isIsoDate(due) || !isIsoDate(today)) throw new Error('Invalid date');
  const [y1, m1, d1] = today.split('-').map(Number);
  const [y2, m2, d2] = due.split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86_400_000);
}

/** "2 Nov" — day and short month, no leading zero. */
export function formatDayMonth(isoDate: string): string {
  if (!isIsoDate(isoDate)) throw new Error(`Invalid date: ${isoDate}`);
  const [, month, day] = isoDate.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

export function isoDateFromDb(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

export function dbDateFromIso(isoDate: string): Date {
  if (!isIsoDate(isoDate)) throw new Error(`Invalid date: ${isoDate}`);
  return new Date(`${isoDate}T00:00:00.000Z`);
}
