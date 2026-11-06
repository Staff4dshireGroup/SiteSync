/**
 * Pure mapping between SiteSync projects/timesheets and Xero Projects payloads.
 * Xero project names used by this business look like "Sp1166 - <address>".
 */

export const JOB_CODE_PREFIXES = ['Sp', 'Sc', 'Sf', 'Sg', 'Is'] as const;

export const XERO_TIME_MIN_MINUTES = 1;
export const XERO_TIME_MAX_MINUTES = 59940;
export const XERO_PROJECT_NAME_MAX = 200;
export const XERO_TIME_DESCRIPTION_MAX = 500;

const JOB_CODE_RE = /(?:^|[\s([{\-–—])((?:sp|sc|sf|sg|is))(\d+)\b/i;

export function canonicalJobCode(prefix: string, digits: string): string {
  const match = JOB_CODE_PREFIXES.find((p) => p.toLowerCase() === prefix.toLowerCase());
  return `${match ?? prefix}${digits}`;
}

/** First job code in the text, or null. "is 12" does not match; "Is12" and "Sp1166" do. */
export function extractJobCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = JOB_CODE_RE.exec(text);
  if (!match) return null;
  return canonicalJobCode(match[1], match[2]);
}

export function extractJobCodeFromProject(project: { name: string; address?: string | null }): string | null {
  return extractJobCode(project.name) ?? extractJobCode(project.address);
}

export type XeroProjectRef = {
  projectId: string;
  name: string;
  status?: string | null;
};

export function matchXeroProjectsByJobCode<T extends XeroProjectRef>(
  site: { name: string; address?: string | null },
  projects: T[]
): { code: string | null; matches: T[] } {
  const code = extractJobCodeFromProject(site);
  if (!code) return { code: null, matches: [] };
  const matches = projects.filter((project) => extractJobCode(project.name)?.toLowerCase() === code.toLowerCase());
  return { code, matches };
}

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? trimmed.slice(0, max).trim() : trimmed;
}

function placeFromAddress(address: string, code: string | null): string {
  if (!code) return address;
  const stripped = address.replace(new RegExp(`^${code}\\s*-?\\s*`, 'i'), '').trim();
  return stripped || address;
}

/**
 * Build the Xero project name. When a job code and street address are known and the
 * SiteSync name does not already contain that address, the result is "Sp1166 - <address>".
 */
export function buildXeroProjectName(project: { name: string; address?: string | null }): string {
  const name = project.name.replace(/\s+/g, ' ').trim();
  const address = (project.address ?? '').replace(/\s+/g, ' ').trim();
  const code = extractJobCode(name) ?? extractJobCode(address);
  const nameHasAddress = address.length > 0 && name.toLowerCase().includes(address.toLowerCase());

  if (code && address && !nameHasAddress) {
    const place = placeFromAddress(address, code);
    if (place.toLowerCase() !== code.toLowerCase()) {
      return clip(`${code} - ${place}`, XERO_PROJECT_NAME_MAX);
    }
  }
  if (code && !extractJobCode(name)) {
    return clip(`${code} - ${name}`, XERO_PROJECT_NAME_MAX);
  }
  if (!code && address && !nameHasAddress) {
    return clip(`${name} - ${address}`, XERO_PROJECT_NAME_MAX);
  }
  return clip(name, XERO_PROJECT_NAME_MAX);
}

export type XeroUserRef = {
  userId: string;
  email?: string | null;
  name?: string | null;
};

export function resolveXeroUser(input: {
  staffEmail: string;
  xeroUsers: XeroUserRef[];
  defaultUserId?: string | null;
}): { ok: true; userId: string; matchedBy: 'email' | 'default' } | { ok: false; error: string } {
  const email = input.staffEmail.trim().toLowerCase();
  const byEmail = input.xeroUsers.find((user) => (user.email ?? '').trim().toLowerCase() === email && user.userId);
  if (byEmail) return { ok: true, userId: byEmail.userId, matchedBy: 'email' };
  const fallback = input.defaultUserId?.trim();
  if (fallback) return { ok: true, userId: fallback, matchedBy: 'default' };
  return {
    ok: false,
    error:
      'No Xero user matches this staff email. Set a default Xero user in Settings → Xero, or invite the staff member to the Xero organisation.',
  };
}

/** Minutes between sign-in and sign-out. Sub-minute positive shifts round up to 1. Zero or negative returns 0. */
export function durationMinutes(signInAt: Date, signOutAt: Date): number {
  const ms = signOutAt.getTime() - signInAt.getTime();
  if (ms <= 0) return 0;
  const rounded = Math.round(ms / 60_000);
  return rounded < XERO_TIME_MIN_MINUTES ? XERO_TIME_MIN_MINUTES : rounded;
}

export function buildTimeDescription(input: {
  staffName: string;
  staffEmail: string;
  projectName: string;
  signInAt: Date;
  signOutAt: Date;
  travelMinutes?: number | null;
  travelMiles?: number | null;
}): string {
  const parts = [
    `SiteSync attendance: ${input.staffName.trim() || input.staffEmail} (${input.staffEmail})`,
    `on ${input.projectName.trim()}`,
    `In ${input.signInAt.toISOString()}`,
    `out ${input.signOutAt.toISOString()}`,
  ];
  const travel: string[] = [];
  if (input.travelMinutes != null && Number.isFinite(input.travelMinutes)) {
    travel.push(`${input.travelMinutes} min`);
  }
  if (input.travelMiles != null && Number.isFinite(input.travelMiles)) {
    travel.push(`${input.travelMiles} mi`);
  }
  if (travel.length) parts.push(`Travel ${travel.join(', ')}`);
  return clip(parts.join('. ') + '.', XERO_TIME_DESCRIPTION_MAX);
}

export type TimeMapInput = {
  timeEntryId: string;
  signInAt: Date;
  signOutAt: Date | null;
  approvedAt: Date | null;
  travelMinutes?: number | null;
  travelMiles?: number | null;
  staffName: string;
  staffEmail: string;
  projectName: string;
  xeroProjectId: string | null;
  xeroUserId: string | null;
  xeroTaskId: string | null;
  userMatch?: 'email' | 'default' | null;
  alreadySynced: boolean;
};

export type XeroTimeCreateBody = {
  userId: string;
  taskId: string;
  dateUtc: string;
  duration: number;
  description: string;
};

export type TimeMapResult =
  | { ok: true; idempotencyKey: string; body: XeroTimeCreateBody; duration: number; userMatch: 'email' | 'default' | null }
  | { ok: false; status: 'skipped' | 'failed'; error: string };

export function mapTimeEntryToXero(input: TimeMapInput): TimeMapResult {
  if (input.alreadySynced) {
    return { ok: false, status: 'skipped', error: 'Already synced to this Xero organisation' };
  }
  if (!input.approvedAt) {
    return { ok: false, status: 'skipped', error: 'Timesheet is not approved' };
  }
  if (!input.signOutAt) {
    return { ok: false, status: 'skipped', error: 'Shift is still open' };
  }
  if (!input.xeroProjectId) {
    return { ok: false, status: 'skipped', error: 'Project is not linked to a Xero project' };
  }
  if (!input.xeroUserId) {
    return {
      ok: false,
      status: 'failed',
      error:
        'No Xero user for this staff member. Match their email to a Xero user or set a default Xero user.',
    };
  }
  if (!input.xeroTaskId) {
    return { ok: false, status: 'failed', error: 'Xero project has no task to log time against' };
  }

  const duration = durationMinutes(input.signInAt, input.signOutAt);
  if (duration < XERO_TIME_MIN_MINUTES) {
    return { ok: false, status: 'failed', error: 'Duration is zero' };
  }
  if (duration > XERO_TIME_MAX_MINUTES) {
    return {
      ok: false,
      status: 'failed',
      error: `Duration ${duration} minutes exceeds Xero's limit of ${XERO_TIME_MAX_MINUTES}`,
    };
  }

  return {
    ok: true,
    idempotencyKey: input.timeEntryId,
    duration,
    userMatch: input.userMatch ?? null,
    body: {
      userId: input.xeroUserId,
      taskId: input.xeroTaskId,
      dateUtc: input.signInAt.toISOString(),
      duration,
      description: buildTimeDescription({
        staffName: input.staffName,
        staffEmail: input.staffEmail,
        projectName: input.projectName,
        signInAt: input.signInAt,
        signOutAt: input.signOutAt,
        travelMinutes: input.travelMinutes,
        travelMiles: input.travelMiles,
      }),
    },
  };
}
