import { Router } from 'express';
import { prisma } from '../db';
import type { AuthedRequest } from '../middleware/auth';
import { authMiddleware, effectiveRole } from '../middleware/auth';
import * as S from '../lib/serialize';
import { validateAttendanceAtProject } from '../lib/geo';
import { canUserWorkOnProject } from '../lib/projectAccess';
import { reverseGeocodeAddress } from '../lib/reverseGeocode';
import { pushApprovedTime, pushOnApprovalEnabled } from '../services/xeroTimeSync';

const router = Router();
router.use(authMiddleware);

function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371000 * c;
}

async function userInCompany(req: AuthedRequest, userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u) return null;
  if (req.userRole === 'superadmin') return u;
  if (u.companyId !== req.companyId) return false;
  return u;
}

router.get('/', async (req: AuthedRequest, res) => {
  const where =
    req.userRole === 'superadmin'
      ? {}
      : {
          user: { companyId: req.companyId! },
        };
  const entries = await prisma.timeEntry.findMany({
    where,
    orderBy: { signInAt: 'desc' },
    take: 500,
  });
  res.json(entries.map(S.timeEntry));
});

router.get('/user/:userId', async (req: AuthedRequest, res) => {
  const ok = await userInCompany(req, req.params.userId);
  if (ok === null) return res.status(404).json({ error: 'User not found' });
  if (ok === false) return res.status(403).json({ error: 'Forbidden' });
  if (req.userId !== req.params.userId && !['supervisor', 'admin', 'superadmin'].includes(effectiveRole(req))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const entries = await prisma.timeEntry.findMany({
    where: { userId: req.params.userId },
    orderBy: { signInAt: 'desc' },
  });
  res.json(entries.map(S.timeEntry));
});

router.get('/:id', async (req: AuthedRequest, res) => {
  const t = await prisma.timeEntry.findUnique({
    where: { id: req.params.id },
    include: { user: true },
  });
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (req.userRole !== 'superadmin' && t.user.companyId !== req.companyId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (t.userId !== req.userId && !['supervisor', 'admin', 'superadmin'].includes(effectiveRole(req))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(S.timeEntry(t));
});

router.post('/', async (req: AuthedRequest, res) => {
  const body = req.body ?? {};
  const userId = body.user_id ?? body.userId ?? req.userId;
  const projectId = body.project_id ?? body.projectId;
  if (!userId || !projectId) {
    return res.status(400).json({ error: 'user_id and project_id required' });
  }
  if (userId !== req.userId && !['admin', 'superadmin'].includes(effectiveRole(req))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || (req.userRole !== 'superadmin' && project.companyId !== req.companyId)) {
    return res.status(400).json({ error: 'Invalid project' });
  }
  if (
    req.userRole !== 'superadmin' &&
    !canUserWorkOnProject(userId, project)
  ) {
    return res.status(403).json({ error: 'Only the assigned supervisor or staff can use this project' });
  }

  const lat = Number(body.latitude_in ?? body.latitudeIn);
  const lng = Number(body.longitude_in ?? body.longitudeIn);
  const accuracyRaw = body.accuracy_in ?? body.accuracyIn ?? body.accuracy;
  const accuracy =
    accuracyRaw != null && accuracyRaw !== '' ? Number(accuracyRaw) : null;

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'latitude_in and longitude_in required' });
  }

  const validation = validateAttendanceAtProject(project, lat, lng, accuracy, 'sign_in');
  if (!validation.ok) {
    return res.status(validation.status).json({ error: validation.error });
  }

  const signInAt = body.timestamp
    ? new Date(body.timestamp)
    : body.sign_in_at
      ? new Date(body.sign_in_at)
      : new Date();

  const t = await prisma.timeEntry.create({
    data: {
      userId,
      projectId,
      signInAt: Number.isNaN(signInAt.getTime()) ? new Date() : signInAt,
      latitudeIn: lat,
      longitudeIn: lng,
      signInAddress: await reverseGeocodeAddress(lat, lng),
      accuracyIn: accuracy != null && !Number.isNaN(accuracy) ? accuracy : null,
      distanceFromProjectInM: validation.distanceM,
    },
  });
  res.status(201).json(S.timeEntry(t));
});

router.put('/:id', async (req: AuthedRequest, res) => {
  const existing = await prisma.timeEntry.findUnique({
    where: { id: req.params.id },
    include: { user: true },
  });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (req.userRole !== 'superadmin' && existing.user.companyId !== req.companyId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (existing.userId !== req.userId && !['supervisor', 'admin', 'superadmin'].includes(effectiveRole(req))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const body = req.body ?? {};
  const project = await prisma.project.findUnique({ where: { id: existing.projectId } });
  if (!project) return res.status(400).json({ error: 'Project missing' });
  if (
    req.userRole !== 'superadmin' &&
    !canUserWorkOnProject(existing.userId, project)
  ) {
    return res.status(403).json({ error: 'Only the assigned supervisor or staff can use this project' });
  }

  const lat = Number(body.latitude_out ?? body.latitudeOut);
  const lng = Number(body.longitude_out ?? body.longitudeOut);
  const accuracyRaw = body.accuracy_out ?? body.accuracyOut ?? body.accuracy;
  const accuracy =
    accuracyRaw != null && accuracyRaw !== '' ? Number(accuracyRaw) : null;

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'latitude_out and longitude_out required' });
  }

  const validation = validateAttendanceAtProject(project, lat, lng, accuracy, 'sign_out');
  if (!validation.ok) {
    return res.status(validation.status).json({ error: validation.error });
  }

  const signOutAt = body.timestamp
    ? new Date(body.timestamp)
    : body.sign_out_at != null
      ? new Date(body.sign_out_at)
      : new Date();

  const t = await prisma.timeEntry.update({
    where: { id: req.params.id },
    data: {
      signOutAt: Number.isNaN(signOutAt.getTime()) ? new Date() : signOutAt,
      latitudeOut: lat,
      longitudeOut: lng,
      signOutAddress: await reverseGeocodeAddress(lat, lng),
      accuracyOut: accuracy != null && !Number.isNaN(accuracy) ? accuracy : null,
      distanceFromProjectOutM: validation.distanceM,
    },
  });
  res.json(S.timeEntry(t));
});

router.put('/:id/arrive', async (req: AuthedRequest, res) => {
  const existing = await prisma.timeEntry.findUnique({
    where: { id: req.params.id },
    include: { user: true, project: true },
  });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (req.userRole !== 'superadmin' && existing.user.companyId !== req.companyId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (existing.userId !== req.userId && !['supervisor', 'admin', 'superadmin'].includes(effectiveRole(req))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (existing.project.projectType !== 'callout') {
    return res.status(400).json({ error: 'Arrival tracking applies to callout projects only' });
  }
  if (existing.arrivedAt) {
    return res.status(400).json({ error: 'Arrival already recorded' });
  }

  const lat = Number(req.body?.arrival_latitude ?? req.body?.latitude ?? req.body?.lat);
  const lng = Number(req.body?.arrival_longitude ?? req.body?.longitude ?? req.body?.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'arrival latitude and longitude required' });
  }
  const arrivedAtRaw = req.body?.arrived_at ? new Date(req.body.arrived_at) : new Date();
  const arrivedAt = Number.isNaN(arrivedAtRaw.getTime()) ? new Date() : arrivedAtRaw;
  if (existing.project.latitude != null && existing.project.longitude != null) {
    const distanceToProjectM = haversineDistanceMeters(
      lat,
      lng,
      existing.project.latitude,
      existing.project.longitude
    );
    const radius =
      existing.project.allowedRadiusMeters != null && existing.project.allowedRadiusMeters > 0
        ? existing.project.allowedRadiusMeters
        : 150;
    if (distanceToProjectM > radius) {
      return res.status(400).json({
        error: `Arrival can only be confirmed on site (${Math.round(distanceToProjectM)} m away; allowed ${Math.round(radius)} m).`,
      });
    }
  }

  const travelMinutes = Math.max(
    0,
    Math.round((arrivedAt.getTime() - existing.signInAt.getTime()) / 60000)
  );
  const travelMiles = haversineDistanceMeters(
    existing.latitudeIn ?? lat,
    existing.longitudeIn ?? lng,
    lat,
    lng
  ) / 1609.344;

  const updated = await prisma.timeEntry.update({
    where: { id: existing.id },
    data: {
      arrivedAt,
      arrivalLatitude: lat,
      arrivalLongitude: lng,
      arrivalAddress: await reverseGeocodeAddress(lat, lng),
      travelMinutes,
      travelMiles,
    },
  });
  res.json(S.timeEntry(updated));
});

router.delete('/:id', async (req: AuthedRequest, res) => {
  const existing = await prisma.timeEntry.findUnique({
    where: { id: req.params.id },
    include: { user: true },
  });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (req.userRole !== 'superadmin' && existing.user.companyId !== req.companyId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!['admin', 'superadmin'].includes(effectiveRole(req)) && existing.userId !== req.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await prisma.timeEntry.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

router.put('/:id/approve', async (req: AuthedRequest, res) => {
  const role = effectiveRole(req);
  if (!['supervisor', 'admin', 'superadmin'].includes(role)) {
    return res.status(403).json({ error: 'Only supervisors/admins can approve timesheets' });
  }

  const existing = await prisma.timeEntry.findUnique({
    where: { id: req.params.id },
    include: { user: true, project: true },
  });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (req.userRole !== 'superadmin' && existing.user.companyId !== req.companyId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!existing.signOutAt) {
    return res.status(400).json({ error: 'Only completed timesheets can be approved' });
  }

  if (role === 'supervisor') {
    if (!existing.project || existing.project.supervisorId !== req.userId) {
      return res.status(403).json({ error: 'Only assigned supervisor can approve this timesheet' });
    }
  }

  const updated = await prisma.timeEntry.update({
    where: { id: existing.id },
    data: {
      approvedByUserId: req.userId,
      approvedAt: new Date(),
    },
  });

  let xeroSync: { status: string; error?: string; xero_time_id?: string | null } | null = null;
  if (pushOnApprovalEnabled() && existing.project.companyId) {
    try {
      const pushed = await pushApprovedTime({
        companyId: existing.project.companyId,
        actorUserId: req.userId,
        timeEntryId: updated.id,
        limit: 1,
      });
      const first = pushed.results[0];
      xeroSync = first
        ? { status: first.status, error: first.error, xero_time_id: first.xero_time_id }
        : { status: 'skipped', error: 'Nothing to push' };
    } catch (e) {
      const message = (e as Error).message;
      if (!message.includes('No active Xero')) {
        xeroSync = { status: 'failed', error: message };
      }
    }
  }

  res.json({ ...S.timeEntry(updated), ...(xeroSync ? { xero_sync: xeroSync } : {}) });
});

export default router;
