import type { UserRole } from '../models/user';

/** High-level capabilities aligned with the legacy Staff4dshire role model. */
export type Capability =
  | 'sign_in_out'
  | 'own_timesheet'
  | 'compliance_self'
  | 'submit_job_completion'
  | 'report_incident'
  | 'approve_timesheets'
  | 'supervisor_compliance'
  | 'manage_users'
  | 'manage_companies'
  | 'manage_projects'
  | 'view_reports'
  | 'manage_invoices'
  | 'inductions_admin'
  | 'cross_company'
  | 'manage_vehicles'
  | 'allocate_vehicles';

const BY_ROLE: Record<UserRole, Capability[]> = {
  staff: [
    'sign_in_out',
    'own_timesheet',
    'compliance_self',
    'submit_job_completion',
    'report_incident',
  ],
  supervisor: [
    'sign_in_out',
    'own_timesheet',
    'compliance_self',
    'submit_job_completion',
    'report_incident',
    'approve_timesheets',
    'supervisor_compliance',
    'view_reports',
    'allocate_vehicles',
  ],
  admin: [
    'sign_in_out',
    'own_timesheet',
    'compliance_self',
    'submit_job_completion',
    'report_incident',
    'approve_timesheets',
    'manage_users',
    'manage_companies',
    'manage_projects',
    'view_reports',
    'manage_invoices',
    'inductions_admin',
    'manage_vehicles',
    'allocate_vehicles',
  ],
  superadmin: [
    'manage_users',
    'manage_companies',
    'manage_projects',
    'view_reports',
    'inductions_admin',
    'cross_company',
    'manage_vehicles',
    'allocate_vehicles',
  ],
};

export function hasCapability(role: UserRole | undefined, capability: Capability): boolean {
  if (!role) return false;
  return BY_ROLE[role].includes(capability);
}

export function isElevatedRole(role: UserRole | undefined): boolean {
  return role === 'supervisor' || role === 'admin' || role === 'superadmin';
}
