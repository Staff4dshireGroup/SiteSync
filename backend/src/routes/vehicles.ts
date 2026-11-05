import { randomUUID } from 'crypto';
import { Router } from 'express';
import type { Response } from 'express';
import { Prisma, type VehicleFuelType, type VehicleStatus, type VehicleType } from '@prisma/client';
import type { Server as IoServer } from 'socket.io';
import { prisma } from '../db';
import type { AuthedRequest } from '../middleware/auth';
import { authMiddleware, effectiveRole } from '../middleware/auth';
import {
  AllocationError,
  planAllocation,
  planUnallocation,
  activeAllocations,
} from '../vehicles/allocation';
import { blockedResponse, vehicleBlockReasons } from '../vehicles/blocking';
import { dbDateFromIso, isIsoDate, isoDateFromDb, londonToday } from '../vehicles/dates';
import {
  presentVehicle,
  toAllocationRow,
  vehicleDetailInclude,
  vehicleSummaryInclude,
  type PresentableVehicle,
} from '../vehicles/present';
import { isUkRegistration, isValidVin, normalizeRegistration, normalizeVin } from '../vehicles/registration';
import { notifyVehicleCompliance } from '../vehicles/reminders';

const router = Router();
router.use(authMiddleware);

const TYPES: VehicleType[] = ['van', 'pickup', 'car', 'tipper', 'plant_other'];
const FUELS: VehicleFuelType[] = ['petrol', 'diesel', 'electric', 'hybrid', 'other'];
const STATUSES: VehicleStatus[] = ['active', 'off_road', 'sold'];

function canManage(req: AuthedRequest): boolean {
  return ['admin', 'superadmin'].includes(effectiveRole(req));
}

function canAllocate(req: AuthedRequest): boolean {
  return ['admin', 'supervisor', 'superadmin'].includes(effectiveRole(req));
}

function requireCompany(req: AuthedRequest, res: Response): string | null {
  if (!req.companyId) {
    res.status(400).json({ error: 'Select a company' });
    return null;
  }
  return req.companyId;
}

function isCurrentAssignee(vehicle: PresentableVehicle, userId: string, today: string): boolean {
  return activeAllocations(vehicle.allocations.map(toAllocationRow), today).some((row) => row.userId === userId);
}

function allocationBlock(vehicle: PresentableVehicle, today: string) {
  return blockedResponse(
    vehicleBlockReasons({
      status: vehicle.status,
      motDue: isoDateFromDb(vehicle.motDue),
      roadTaxDue: isoDateFromDb(vehicle.roadTaxDue),
      insuranceExpiry: isoDateFromDb(vehicle.insuranceExpiry),
      openDefects: vehicle.defects.filter((defect) => defect.status === 'open').map((defect) => ({ id: defect.id })),
      todayCheck: null,
      purpose: 'allocate',
      today,
    })
  );
}

async function findVehicle(id: string, companyId: string, today: string, detail: boolean) {
  return prisma.vehicle.findFirst({
    where: { id, companyId },
    include: detail ? vehicleDetailInclude : vehicleSummaryInclude(today),
  });
}

function scheduleReminder(req: AuthedRequest, vehicleId: string) {
  const io = req.app.get('io') as IoServer | undefined;
  void notifyVehicleCompliance(prisma, io, { vehicleId }).catch((error: Error) => {
    console.error('[vehicle-compliance]', error.message);
  });
}

function hasOwn(body: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(body, key));
}

function readDate(body: Record<string, unknown>, keys: string[]): { ok: true; value: string | null } | { ok: false } {
  const key = keys.find((name) => Object.prototype.hasOwnProperty.call(body, name));
  if (!key) return { ok: true, value: null };
  const raw = body[key];
  if (raw == null || raw === '') return { ok: true, value: null };
  const value = String(raw).slice(0, 10);
  if (!isIsoDate(value)) return { ok: false };
  return { ok: true, value };
}

function readOptionalInt(body: Record<string, unknown>, keys: string[]): { ok: true; present: boolean; value: number | null } | { ok: false } {
  const key = keys.find((name) => Object.prototype.hasOwnProperty.call(body, name));
  if (!key) return { ok: true, present: false, value: null };
  const raw = body[key];
  if (raw == null || raw === '') return { ok: true, present: true, value: null };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return { ok: false };
  return { ok: true, present: true, value };
}

router.get('/', async (req: AuthedRequest, res) => {
  if (!canAllocate(req)) return res.status(403).json({ error: 'Forbidden' });
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const today = londonToday();
  const todayDate = dbDateFromIso(today);
  const q = String(req.query.q ?? req.query.query ?? '').trim();
  const status = String(req.query.status ?? '').trim();
  const allocatedTo = String(req.query.allocated_to ?? req.query.allocatedTo ?? '').trim();
  const archivedOnly = req.query.archived === 'true';
  const includeArchived = req.query.include_archived === 'true';

  const vehicles = await prisma.vehicle.findMany({
    where: {
      companyId,
      ...(archivedOnly ? { archivedAt: { not: null } } : includeArchived ? {} : { archivedAt: null }),
      ...(STATUSES.includes(status as VehicleStatus) ? { status: status as VehicleStatus } : {}),
      ...(allocatedTo
        ? {
            allocations: {
              some: {
                userId: allocatedTo,
                endedAt: null,
                startDate: { lte: todayDate },
                OR: [{ endDate: null }, { endDate: { gte: todayDate } }],
              },
            },
          }
        : {}),
      ...(q
        ? {
            OR: [
              { registration: { contains: normalizeRegistration(q) || q, mode: 'insensitive' as const } },
              { make: { contains: q, mode: 'insensitive' as const } },
              { model: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    include: vehicleSummaryInclude(today),
    orderBy: [{ registration: 'asc' }],
  });

  res.json(vehicles.map((vehicle) => presentVehicle(vehicle, today, 'summary')));
});

router.get('/mine', async (req: AuthedRequest, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId || !req.userId) return;
  const today = londonToday();
  const vehicles = await prisma.vehicle.findMany({
    where: {
      companyId,
      archivedAt: null,
      allocations: { some: { userId: req.userId, endedAt: null } },
    },
    include: vehicleSummaryInclude(today),
    orderBy: { registration: 'asc' },
  });
  const mine = vehicles.filter((vehicle) => isCurrentAssignee(vehicle, req.userId!, today));
  res.json(mine.map((vehicle) => presentVehicle(vehicle, today, 'summary')));
});

router.get('/:id', async (req: AuthedRequest, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId || !req.userId) return;
  const today = londonToday();
  const vehicle = await findVehicle(req.params.id, companyId, today, true);
  if (!vehicle) return res.status(404).json({ error: 'Not found' });
  if (!canAllocate(req) && !isCurrentAssignee(vehicle, req.userId, today)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const mode = canAllocate(req) ? 'detail' : 'summary';
  res.json(presentVehicle(vehicle, today, mode));
});

router.post('/', async (req: AuthedRequest, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Forbidden' });
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const registration = normalizeRegistration(String(body.registration ?? ''));
  if (!isUkRegistration(registration)) {
    return res.status(400).json({ error: 'Registration must be a UK number plate' });
  }
  const make = String(body.make ?? '').trim();
  const model = String(body.model ?? '').trim();
  const colour = String(body.colour ?? body.color ?? '').trim();
  if (!make || !model || !colour) {
    return res.status(400).json({ error: 'make, model, and colour are required' });
  }
  const type = String(body.type ?? '') as VehicleType;
  if (!TYPES.includes(type)) {
    return res.status(400).json({ error: 'type must be van, pickup, car, tipper, or plant_other' });
  }
  const fuelType = String(body.fuel_type ?? body.fuelType ?? '') as VehicleFuelType;
  if (!FUELS.includes(fuelType)) {
    return res.status(400).json({ error: 'fuel_type must be petrol, diesel, electric, hybrid, or other' });
  }
  const status = (body.status == null || body.status === '' ? 'active' : String(body.status)) as VehicleStatus;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const motDue = readDate(body, ['mot_due', 'motDue']);
  const roadTaxDue = readDate(body, ['road_tax_due', 'roadTaxDue']);
  const insuranceExpiry = readDate(body, ['insurance_expiry', 'insuranceExpiry']);
  const serviceDueDate = readDate(body, ['service_due_date', 'serviceDueDate']);
  if (!motDue.ok || !roadTaxDue.ok || !insuranceExpiry.ok || !serviceDueDate.ok) {
    return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
  }
  const serviceDueMileage = readOptionalInt(body, ['service_due_mileage', 'serviceDueMileage']);
  const currentMileage = readOptionalInt(body, ['current_mileage', 'currentMileage']);
  if (!serviceDueMileage.ok || !currentMileage.ok) {
    return res.status(400).json({ error: 'Mileage must be a whole number' });
  }

  let vin: string | null = null;
  if (body.vin != null && String(body.vin).trim()) {
    if (!isValidVin(String(body.vin))) return res.status(400).json({ error: 'VIN must be 17 characters, excluding I, O and Q' });
    vin = normalizeVin(String(body.vin));
  }

  const projectProvided = Object.prototype.hasOwnProperty.call(body, 'project_id') || Object.prototype.hasOwnProperty.call(body, 'projectId');
  const projectId = projectProvided ? String(body.project_id ?? body.projectId ?? '').trim() || null : null;
  if (projectId) {
    const blocked = blockedResponse(
      vehicleBlockReasons({
        status,
        motDue: motDue.value,
        roadTaxDue: roadTaxDue.value,
        insuranceExpiry: insuranceExpiry.value,
        openDefects: [],
        todayCheck: null,
        purpose: 'allocate',
        today: londonToday(),
      })
    );
    if (blocked) return res.status(409).json(blocked);
    const project = await prisma.project.findFirst({ where: { id: projectId, companyId, deletedAt: null } });
    if (!project) return res.status(400).json({ error: 'Project not found' });
  }

  try {
    const created = await prisma.vehicle.create({
      data: {
        companyId,
        registration,
        make,
        model,
        type,
        colour,
        fuelType,
        vin,
        motDue: motDue.value ? dbDateFromIso(motDue.value) : null,
        roadTaxDue: roadTaxDue.value ? dbDateFromIso(roadTaxDue.value) : null,
        insuranceExpiry: insuranceExpiry.value ? dbDateFromIso(insuranceExpiry.value) : null,
        serviceDueDate: serviceDueDate.value ? dbDateFromIso(serviceDueDate.value) : null,
        serviceDueMileage: serviceDueMileage.value,
        currentMileage: currentMileage.value,
        notes: body.notes == null || body.notes === '' ? null : String(body.notes),
        status,
        photoUrl: body.photo_url == null && body.photoUrl == null ? null : String(body.photo_url ?? body.photoUrl ?? '').trim() || null,
        projectId,
      },
      include: vehicleDetailInclude,
    });
    scheduleReminder(req, created.id);
    res.status(201).json(presentVehicle(created, londonToday(), 'detail'));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'A vehicle with this registration already exists for this company' });
    }
    throw error;
  }
});

router.put('/:id', async (req: AuthedRequest, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Forbidden' });
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const today = londonToday();
  const existing = await findVehicle(req.params.id, companyId, today, true);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const data: Prisma.VehicleUncheckedUpdateInput = {};

  if (body.registration != null) {
    const registration = normalizeRegistration(String(body.registration));
    if (!isUkRegistration(registration)) {
      return res.status(400).json({ error: 'Registration must be a UK number plate' });
    }
    data.registration = registration;
  }
  if (body.make != null) {
    const make = String(body.make).trim();
    if (!make) return res.status(400).json({ error: 'make is required' });
    data.make = make;
  }
  if (body.model != null) {
    const model = String(body.model).trim();
    if (!model) return res.status(400).json({ error: 'model is required' });
    data.model = model;
  }
  if (body.colour != null || body.color != null) {
    const colour = String(body.colour ?? body.color ?? '').trim();
    if (!colour) return res.status(400).json({ error: 'colour is required' });
    data.colour = colour;
  }
  if (body.type != null) {
    const type = String(body.type) as VehicleType;
    if (!TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type' });
    data.type = type;
  }
  if (body.fuel_type != null || body.fuelType != null) {
    const fuelType = String(body.fuel_type ?? body.fuelType) as VehicleFuelType;
    if (!FUELS.includes(fuelType)) return res.status(400).json({ error: 'Invalid fuel_type' });
    data.fuelType = fuelType;
  }
  if (body.status != null) {
    const status = String(body.status) as VehicleStatus;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    data.status = status;
  }
  if (body.vin != null) {
    if (String(body.vin).trim() === '') data.vin = null;
    else if (!isValidVin(String(body.vin))) {
      return res.status(400).json({ error: 'VIN must be 17 characters, excluding I, O and Q' });
    } else data.vin = normalizeVin(String(body.vin));
  }
  if (body.notes != null) data.notes = String(body.notes).trim() || null;
  if (body.photo_url != null || body.photoUrl != null) {
    data.photoUrl = String(body.photo_url ?? body.photoUrl ?? '').trim() || null;
  }

  const motDue = readDate(body, ['mot_due', 'motDue']);
  const roadTaxDue = readDate(body, ['road_tax_due', 'roadTaxDue']);
  const insuranceExpiry = readDate(body, ['insurance_expiry', 'insuranceExpiry']);
  const serviceDueDate = readDate(body, ['service_due_date', 'serviceDueDate']);
  if (!motDue.ok || !roadTaxDue.ok || !insuranceExpiry.ok || !serviceDueDate.ok) {
    return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
  }
  if (hasOwn(body, 'mot_due', 'motDue')) data.motDue = motDue.value ? dbDateFromIso(motDue.value) : null;
  if (hasOwn(body, 'road_tax_due', 'roadTaxDue')) data.roadTaxDue = roadTaxDue.value ? dbDateFromIso(roadTaxDue.value) : null;
  if (hasOwn(body, 'insurance_expiry', 'insuranceExpiry')) {
    data.insuranceExpiry = insuranceExpiry.value ? dbDateFromIso(insuranceExpiry.value) : null;
  }
  if (hasOwn(body, 'service_due_date', 'serviceDueDate')) {
    data.serviceDueDate = serviceDueDate.value ? dbDateFromIso(serviceDueDate.value) : null;
  }
  const serviceDueMileage = readOptionalInt(body, ['service_due_mileage', 'serviceDueMileage']);
  const currentMileage = readOptionalInt(body, ['current_mileage', 'currentMileage']);
  if (!serviceDueMileage.ok || !currentMileage.ok) {
    return res.status(400).json({ error: 'Mileage must be a whole number' });
  }
  if (serviceDueMileage.present) data.serviceDueMileage = serviceDueMileage.value;
  if (currentMileage.present) data.currentMileage = currentMileage.value;

  const projectProvided =
    Object.prototype.hasOwnProperty.call(body, 'project_id') || Object.prototype.hasOwnProperty.call(body, 'projectId');
  if (projectProvided) {
    const projectId = String(body.project_id ?? body.projectId ?? '').trim() || null;
    if (projectId && projectId !== existing.projectId) {
      const project = await prisma.project.findFirst({ where: { id: projectId, companyId, deletedAt: null } });
      if (!project) return res.status(400).json({ error: 'Project not found' });
      const nextStatus = (data.status as VehicleStatus | undefined) ?? existing.status;
      const blocked = blockedResponse(
        vehicleBlockReasons({
          status: nextStatus,
          motDue: data.motDue instanceof Date ? isoDateFromDb(data.motDue) : data.motDue === null ? null : isoDateFromDb(existing.motDue),
          roadTaxDue:
            data.roadTaxDue instanceof Date ? isoDateFromDb(data.roadTaxDue) : data.roadTaxDue === null ? null : isoDateFromDb(existing.roadTaxDue),
          insuranceExpiry:
            data.insuranceExpiry instanceof Date
              ? isoDateFromDb(data.insuranceExpiry)
              : data.insuranceExpiry === null
                ? null
                : isoDateFromDb(existing.insuranceExpiry),
          openDefects: existing.defects.filter((defect) => defect.status === 'open').map((defect) => ({ id: defect.id })),
          todayCheck: null,
          purpose: 'allocate',
          today,
        })
      );
      if (blocked) return res.status(409).json(blocked);
    }
    data.projectId = projectId;
  }

  try {
    await prisma.vehicle.update({ where: { id: existing.id }, data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'A vehicle with this registration already exists for this company' });
    }
    throw error;
  }
  const updated = await findVehicle(existing.id, companyId, today, true);
  scheduleReminder(req, existing.id);
  res.json(presentVehicle(updated!, today, 'detail'));
});

router.post('/:id/archive', async (req: AuthedRequest, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Forbidden' });
  const companyId = requireCompany(req, res);
  if (!companyId || !req.userId) return;
  const today = londonToday();
  const vehicle = await findVehicle(req.params.id, companyId, today, true);
  if (!vehicle) return res.status(404).json({ error: 'Not found' });
  const archived = req.body?.archived === undefined ? true : Boolean(req.body.archived);

  await prisma.$transaction(async (tx) => {
    if (archived) {
      const existing = await tx.vehicleAllocation.findMany({ where: { vehicleId: vehicle.id } });
      try {
        const updates = planUnallocation(
          existing.map((allocation) => ({
            id: allocation.id,
            vehicleId: allocation.vehicleId,
            userId: allocation.userId,
            projectId: allocation.projectId,
            startDate: isoDateFromDb(allocation.startDate)!,
            endDate: isoDateFromDb(allocation.endDate),
            endedAt: allocation.endedAt ? allocation.endedAt.toISOString() : null,
            assignedByUserId: allocation.assignedByUserId,
            assignedAt: allocation.assignedAt.toISOString(),
            endedByUserId: allocation.endedByUserId,
          })),
          { endedByUserId: req.userId!, nowIso: new Date().toISOString() },
          today
        );
        for (const update of updates) {
          await tx.vehicleAllocation.update({
            where: { id: update.id },
            data: {
              endDate: dbDateFromIso(update.endDate),
              endedAt: update.endedAt ? new Date(update.endedAt) : null,
              endedByUserId: update.endedByUserId,
            },
          });
        }
      } catch (error) {
        if (!(error instanceof AllocationError)) throw error;
      }
    }
    await tx.vehicle.update({
      where: { id: vehicle.id },
      data: { archivedAt: archived ? vehicle.archivedAt ?? new Date() : null },
    });
  });

  const updated = await findVehicle(vehicle.id, companyId, today, true);
  res.json(presentVehicle(updated!, today, 'detail'));
});

router.post('/:id/allocate', async (req: AuthedRequest, res) => {
  if (!canAllocate(req)) return res.status(403).json({ error: 'Forbidden' });
  const companyId = requireCompany(req, res);
  if (!companyId || !req.userId) return;
  const today = londonToday();
  const vehicle = await findVehicle(req.params.id, companyId, today, true);
  if (!vehicle) return res.status(404).json({ error: 'Not found' });
  if (vehicle.archivedAt) return res.status(400).json({ error: 'Vehicle is archived' });

  const blocked = allocationBlock(vehicle, today);
  if (blocked) return res.status(409).json(blocked);

  const body = (req.body ?? {}) as Record<string, unknown>;
  const userId = String(body.user_id ?? body.userId ?? '').trim();
  if (!userId) return res.status(400).json({ error: 'user_id is required' });
  const startRaw = String(body.start_date ?? body.startDate ?? today).slice(0, 10);
  if (!isIsoDate(startRaw)) return res.status(400).json({ error: 'start_date must be YYYY-MM-DD' });
  const untilFurther = body.until_further_notice === true || body.untilFurtherNotice === true || body.end_date == null && body.endDate == null;
  let endDate: string | null = null;
  if (!untilFurther) {
    const endRaw = String(body.end_date ?? body.endDate ?? '').slice(0, 10);
    if (!isIsoDate(endRaw)) return res.status(400).json({ error: 'end_date must be YYYY-MM-DD or omitted for until further notice' });
    endDate = endRaw;
  }

  const membership = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });
  if (!membership) return res.status(400).json({ error: 'User is not in this company' });

  const projectProvided =
    Object.prototype.hasOwnProperty.call(body, 'project_id') || Object.prototype.hasOwnProperty.call(body, 'projectId');
  const projectId = projectProvided ? String(body.project_id ?? body.projectId ?? '').trim() || null : null;
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, companyId, deletedAt: null } });
    if (!project) return res.status(400).json({ error: 'Project not found' });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "vehicles" WHERE id = ${vehicle.id} FOR UPDATE`;
      const existing = await tx.vehicleAllocation.findMany({ where: { vehicleId: vehicle.id } });
      const plan = planAllocation(
        existing.map((allocation) => ({
          id: allocation.id,
          vehicleId: allocation.vehicleId,
          userId: allocation.userId,
          projectId: allocation.projectId,
          startDate: isoDateFromDb(allocation.startDate)!,
          endDate: isoDateFromDb(allocation.endDate),
          endedAt: allocation.endedAt ? allocation.endedAt.toISOString() : null,
          assignedByUserId: allocation.assignedByUserId,
          assignedAt: allocation.assignedAt.toISOString(),
          endedByUserId: allocation.endedByUserId,
        })),
        {
          newId: randomUUID(),
          vehicleId: vehicle.id,
          userId,
          projectId,
          startDate: startRaw,
          endDate,
          assignedByUserId: req.userId!,
          nowIso: new Date().toISOString(),
        },
        today
      );
      for (const update of plan.updates) {
        await tx.vehicleAllocation.update({
          where: { id: update.id },
          data: {
            endDate: dbDateFromIso(update.endDate),
            endedAt: update.endedAt ? new Date(update.endedAt) : null,
            endedByUserId: update.endedByUserId,
          },
        });
      }
      await tx.vehicleAllocation.create({
        data: {
          id: plan.created.id,
          vehicleId: plan.created.vehicleId,
          userId: plan.created.userId,
          projectId: plan.created.projectId,
          startDate: dbDateFromIso(plan.created.startDate),
          endDate: plan.created.endDate ? dbDateFromIso(plan.created.endDate) : null,
          assignedByUserId: plan.created.assignedByUserId,
          assignedAt: new Date(plan.created.assignedAt),
        },
      });
      if (projectProvided) {
        await tx.vehicle.update({ where: { id: vehicle.id }, data: { projectId } });
      }
    });
  } catch (error) {
    if (error instanceof AllocationError) return res.status(400).json({ error: error.message });
    throw error;
  }

  const updated = await findVehicle(vehicle.id, companyId, today, true);
  res.status(201).json(presentVehicle(updated!, today, 'detail'));
});

router.post('/:id/unallocate', async (req: AuthedRequest, res) => {
  if (!canAllocate(req)) return res.status(403).json({ error: 'Forbidden' });
  const companyId = requireCompany(req, res);
  if (!companyId || !req.userId) return;
  const today = londonToday();
  const vehicle = await findVehicle(req.params.id, companyId, today, true);
  if (!vehicle) return res.status(404).json({ error: 'Not found' });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "vehicles" WHERE id = ${vehicle.id} FOR UPDATE`;
      const existing = await tx.vehicleAllocation.findMany({ where: { vehicleId: vehicle.id } });
      const updates = planUnallocation(
        existing.map((allocation) => ({
          id: allocation.id,
          vehicleId: allocation.vehicleId,
          userId: allocation.userId,
          projectId: allocation.projectId,
          startDate: isoDateFromDb(allocation.startDate)!,
          endDate: isoDateFromDb(allocation.endDate),
          endedAt: allocation.endedAt ? allocation.endedAt.toISOString() : null,
          assignedByUserId: allocation.assignedByUserId,
          assignedAt: allocation.assignedAt.toISOString(),
          endedByUserId: allocation.endedByUserId,
        })),
        { endedByUserId: req.userId!, nowIso: new Date().toISOString() },
        today
      );
      for (const update of updates) {
        await tx.vehicleAllocation.update({
          where: { id: update.id },
          data: {
            endDate: dbDateFromIso(update.endDate),
            endedAt: update.endedAt ? new Date(update.endedAt) : null,
            endedByUserId: update.endedByUserId,
          },
        });
      }
    });
  } catch (error) {
    if (error instanceof AllocationError) return res.status(400).json({ error: error.message });
    throw error;
  }

  const updated = await findVehicle(vehicle.id, companyId, today, true);
  res.json(presentVehicle(updated!, today, 'detail'));
});

router.post('/:id/checks', async (req: AuthedRequest, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId || !req.userId) return;
  const today = londonToday();
  const vehicle = await findVehicle(req.params.id, companyId, today, true);
  if (!vehicle) return res.status(404).json({ error: 'Not found' });
  if (vehicle.archivedAt) return res.status(400).json({ error: 'Vehicle is archived' });
  if (!canAllocate(req) && !isCurrentAssignee(vehicle, req.userId, today)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const mileage = Number(body.mileage);
  if (!Number.isInteger(mileage) || mileage < 0) {
    return res.status(400).json({ error: 'mileage must be a whole number' });
  }
  const hasDefects = Boolean(body.has_defects ?? body.hasDefects);
  const unsafe = Boolean(body.unsafe);
  const notes = body.notes == null ? '' : String(body.notes).trim();
  if (hasDefects && !notes) return res.status(400).json({ error: 'Notes are required when reporting a defect' });
  if (unsafe && !hasDefects) return res.status(400).json({ error: 'An unsafe defect requires defects to be reported' });

  await prisma.$transaction(async (tx) => {
    const check = await tx.vehicleCheck.create({
      data: {
        vehicleId: vehicle.id,
        userId: req.userId!,
        mileage,
        hasDefects,
        unsafe,
        result: hasDefects ? 'fail' : 'pass',
        notes: notes || null,
        checkedOn: dbDateFromIso(today),
      },
    });
    if (unsafe) {
      await tx.vehicleDefect.create({
        data: {
          vehicleId: vehicle.id,
          checkId: check.id,
          notes,
          status: 'open',
        },
      });
    }
    await tx.vehicle.update({ where: { id: vehicle.id }, data: { currentMileage: mileage } });
  });

  const updated = await findVehicle(vehicle.id, companyId, today, true);
  const mode = canAllocate(req) ? 'detail' : 'summary';
  res.status(201).json(presentVehicle(updated!, today, mode));
});

router.post('/:id/defects/:defectId/resolve', async (req: AuthedRequest, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Forbidden' });
  const companyId = requireCompany(req, res);
  if (!companyId || !req.userId) return;
  const today = londonToday();
  const vehicle = await findVehicle(req.params.id, companyId, today, true);
  if (!vehicle) return res.status(404).json({ error: 'Not found' });
  const defect = vehicle.defects.find((item) => item.id === req.params.defectId);
  if (!defect) return res.status(404).json({ error: 'Defect not found' });
  if (defect.status === 'resolved') return res.status(400).json({ error: 'Defect is already resolved' });
  const notes = String(req.body?.resolution_notes ?? req.body?.resolutionNotes ?? '').trim();
  if (!notes) return res.status(400).json({ error: 'resolution_notes are required' });

  await prisma.vehicleDefect.update({
    where: { id: defect.id },
    data: {
      status: 'resolved',
      resolutionNotes: notes,
      resolvedAt: new Date(),
      resolvedByUserId: req.userId,
    },
  });
  const updated = await findVehicle(vehicle.id, companyId, today, true);
  res.json(presentVehicle(updated!, today, 'detail'));
});

router.post('/:id/use', async (req: AuthedRequest, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId || !req.userId) return;
  const today = londonToday();
  const vehicle = await findVehicle(req.params.id, companyId, today, true);
  if (!vehicle) return res.status(404).json({ error: 'Not found' });
  if (vehicle.archivedAt) return res.status(400).json({ error: 'Vehicle is archived' });
  if (!canAllocate(req) && !isCurrentAssignee(vehicle, req.userId, today)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const presented = presentVehicle(vehicle, today, 'detail');
  const blocked = blockedResponse(presented.block_reasons);
  if (blocked) return res.status(409).json(blocked);

  await prisma.vehicleDayUse.upsert({
    where: { vehicleId_usedOn: { vehicleId: vehicle.id, usedOn: dbDateFromIso(today) } },
    update: {},
    create: { vehicleId: vehicle.id, userId: req.userId, usedOn: dbDateFromIso(today) },
  });
  res.json({ ok: true, used_on: today, vehicle: presented });
});

export default router;
