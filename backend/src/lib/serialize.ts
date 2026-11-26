import type {
  User as PrismaUser,
  Company,
  Project,
  TimeEntry,
  Conversation,
  Message,
  Notification,
  JobCompletion,
  Incident,
  Document,
  OnboardingRecord,
} from '@prisma/client';

/** iOS (ATS) refuses http:// images; upgrade any non-local http URL to https. */
function secureUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^http:\/\/(localhost|127\.|10\.|192\.168\.)/.test(url)) return url;
  return url.replace(/^http:\/\//, 'https://');
}

export function user(u: PrismaUser) {
  return {
    id: u.id,
    email: u.email,
    first_name: u.firstName,
    last_name: u.lastName,
    role: u.role,
    company_id: u.companyId,
    photo_url: secureUrl(u.photoUrl),
    must_change_password: u.mustChangePassword,
    is_active: u.isActive,
    last_login_at: u.lastLoginAt?.toISOString(),
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
  };
}

export function company(c: Company) {
  return {
    id: c.id,
    name: c.name,
    is_active: c.isActive,
    is_suspended: c.isSuspended,
    is_archived: c.isArchived,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

/** True when start_date is set and on or before today (UTC calendar day). Matches legacy _canBeActive. */
export function projectCanBeActive(startDate: Date | null | undefined): boolean {
  if (startDate == null) return false;
  const s = new Date(startDate);
  const startDay = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return startDay <= today;
}

export function project(p: Project) {
  return {
    id: p.id,
    name: p.name,
    company_id: p.companyId,
    address: p.address ?? undefined,
    latitude: p.latitude ?? undefined,
    longitude: p.longitude ?? undefined,
    allowed_radius_meters: p.allowedRadiusMeters,
    project_type: p.projectType,
    category: p.category ?? undefined,
    start_date: p.startDate?.toISOString(),
    can_be_active: projectCanBeActive(p.startDate),
    photo_urls: p.photoUrls ?? [],
    supervisor_id: p.supervisorId ?? undefined,
    assigned_staff_id: p.assignedStaffId ?? undefined,
    created_by_user_id: p.createdByUserId ?? undefined,
    completed: p.completed,
    completed_at: p.completedAt?.toISOString(),
    archived: p.archived,
    archived_at: p.archivedAt?.toISOString(),
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

export function timeEntry(t: TimeEntry) {
  return {
    id: t.id,
    user_id: t.userId,
    project_id: t.projectId,
    sign_in_at: t.signInAt.toISOString(),
    sign_out_at: t.signOutAt?.toISOString(),
    latitude_in: t.latitudeIn ?? undefined,
    longitude_in: t.longitudeIn ?? undefined,
    sign_in_address: t.signInAddress ?? undefined,
    arrived_at: t.arrivedAt?.toISOString(),
    arrival_latitude: t.arrivalLatitude ?? undefined,
    arrival_longitude: t.arrivalLongitude ?? undefined,
    arrival_address: t.arrivalAddress ?? undefined,
    travel_minutes: t.travelMinutes ?? undefined,
    travel_miles: t.travelMiles ?? undefined,
    latitude_out: t.latitudeOut ?? undefined,
    longitude_out: t.longitudeOut ?? undefined,
    sign_out_address: t.signOutAddress ?? undefined,
    accuracy_in: t.accuracyIn ?? undefined,
    accuracy_out: t.accuracyOut ?? undefined,
    distance_from_project_in_m: t.distanceFromProjectInM ?? undefined,
    distance_from_project_out_m: t.distanceFromProjectOutM ?? undefined,
    approved_by_user_id: t.approvedByUserId ?? undefined,
    approved_at: t.approvedAt?.toISOString(),
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  };
}

export function message(m: Message) {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    sender_id: m.senderId,
    content: m.content,
    attachment_url: m.attachmentUrl ?? undefined,
    read_by: m.readBy,
    created_at: m.createdAt.toISOString(),
  };
}

export function conversation(
  c: Conversation & { participants: { userId: string }[]; messages?: Message[] }
) {
  const base = {
    id: c.id,
    participants: c.participants.map((p) => p.userId),
    project_id: c.projectId ?? undefined,
    name: c.name ?? undefined,
    type: c.type,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
  if (c.messages?.length) {
    const last = c.messages[c.messages.length - 1];
    return { ...base, last_message: message(last) };
  }
  return base;
}

export function notification(n: Notification) {
  return {
    id: n.id,
    user_id: n.userId,
    title: n.title,
    body: n.body,
    type: n.type as 'info' | 'warning' | 'error' | 'success',
    action_route: n.actionRoute ?? undefined,
    action_params: n.actionParams ?? undefined,
    read: n.read,
    created_at: n.createdAt.toISOString(),
  };
}

export function jobCompletion(j: JobCompletion) {
  return {
    id: j.id,
    user_id: j.userId,
    project_id: j.projectId,
    description: j.description,
    photo_urls: j.photoUrls,
    status: j.status,
    created_at: j.createdAt.toISOString(),
    updated_at: j.updatedAt.toISOString(),
  };
}

export function incident(i: Incident) {
  return {
    id: i.id,
    user_id: i.userId,
    project_id: i.projectId ?? undefined,
    description: i.description,
    severity: i.severity,
    photo_url: i.photoUrl ?? undefined,
    status: i.status,
    resolution_report: i.resolutionReport ?? undefined,
    resolution_photo_url: i.resolutionPhotoUrl ?? undefined,
    resolved_by_user_id: i.resolvedByUserId ?? undefined,
    resolved_at: i.resolvedAt?.toISOString(),
    created_at: i.createdAt.toISOString(),
    updated_at: i.updatedAt.toISOString(),
  };
}

export function document(d: Document) {
  return {
    id: d.id,
    user_id: d.userId,
    type: d.type,
    name: d.name,
    url: d.url,
    expiry_date: d.expiryDate?.toISOString(),
    verified: d.verified,
    created_at: d.createdAt.toISOString(),
    updated_at: d.updatedAt.toISOString(),
  };
}

type OnboardingWithUser = OnboardingRecord & {
  lastReminderAt?: Date | null;
  user?: { firstName: string; lastName: string; email: string; role: string };
};

export function onboardingRecord(o: OnboardingWithUser) {
  const base = {
    id: o.id,
    user_id: o.userId,
    status: o.status,
    completed_at: o.completedAt?.toISOString(),
    last_reminder_at: o.lastReminderAt?.toISOString(),
    new_starter: o.newStarter ?? undefined,
    qualifications: o.qualifications ?? undefined,
    policies: o.policies ?? undefined,
    cis: o.cis ?? undefined,
    created_at: o.createdAt.toISOString(),
    updated_at: o.updatedAt.toISOString(),
  };
  if (o.user) {
    return {
      ...base,
      user_email: o.user.email,
      user_name: `${o.user.firstName} ${o.user.lastName}`.trim(),
      user_role: o.user.role,
    };
  }
  return base;
}
