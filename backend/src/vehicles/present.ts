import type { VehicleFuelType, VehicleStatus, VehicleType } from '@prisma/client';
import { activeAllocations, isActiveAllocation, type AllocationRow } from './allocation';
import { vehicleBlockReasons, type BlockReason } from './blocking';
import { dbDateFromIso, isoDateFromDb } from './dates';
import { assessExpiry, type ExpiryAssessment } from './expiry';
import { formatRegistration } from './registration';

interface Person {
  id: string;
  firstName: string;
  lastName: string;
}

interface Named {
  id: string;
  name: string;
}

export interface PresentableAllocation {
  id: string;
  vehicleId: string;
  userId: string;
  user: Person;
  projectId: string | null;
  project: Named | null;
  startDate: Date;
  endDate: Date | null;
  assignedByUserId: string;
  assignedBy: Person;
  assignedAt: Date;
  endedAt: Date | null;
  endedByUserId: string | null;
}

export interface PresentableCheck {
  id: string;
  vehicleId: string;
  userId: string;
  user: Person;
  mileage: number;
  hasDefects: boolean;
  unsafe: boolean;
  result: 'pass' | 'fail';
  notes: string | null;
  checkedOn: Date;
  createdAt: Date;
}

export interface PresentableDefect {
  id: string;
  vehicleId: string;
  checkId: string;
  notes: string;
  status: 'open' | 'resolved';
  resolvedByUserId: string | null;
  resolvedBy: Person | null;
  resolvedAt: Date | null;
  resolutionNotes: string | null;
  createdAt: Date;
}

export interface PresentableVehicle {
  id: string;
  companyId: string;
  registration: string;
  make: string;
  model: string;
  type: VehicleType;
  colour: string;
  fuelType: VehicleFuelType;
  vin: string | null;
  motDue: Date | null;
  roadTaxDue: Date | null;
  insuranceExpiry: Date | null;
  serviceDueDate: Date | null;
  serviceDueMileage: number | null;
  currentMileage: number | null;
  notes: string | null;
  status: VehicleStatus;
  photoUrl: string | null;
  projectId: string | null;
  project: Named | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  allocations: PresentableAllocation[];
  checks: PresentableCheck[];
  defects: PresentableDefect[];
}

const personSelect = { id: true, firstName: true, lastName: true } as const;
const projectSelect = { id: true, name: true } as const;

export function vehicleSummaryInclude(today: string) {
  return {
    project: { select: projectSelect },
    allocations: {
      where: { endedAt: null },
      include: {
        user: { select: personSelect },
        project: { select: projectSelect },
        assignedBy: { select: personSelect },
      },
      orderBy: { startDate: 'desc' as const },
    },
    checks: {
      where: { checkedOn: dbDateFromIso(today) },
      orderBy: { createdAt: 'desc' as const },
      take: 1,
      include: { user: { select: personSelect } },
    },
    defects: {
      where: {
        OR: [{ status: 'open' as const }, { check: { checkedOn: dbDateFromIso(today) } }],
      },
      orderBy: { createdAt: 'desc' as const },
      include: { resolvedBy: { select: personSelect } },
    },
  };
}

export const vehicleDetailInclude = {
  project: { select: projectSelect },
  allocations: {
    include: {
      user: { select: personSelect },
      project: { select: projectSelect },
      assignedBy: { select: personSelect },
    },
    orderBy: { assignedAt: 'desc' as const },
  },
  checks: {
    include: { user: { select: personSelect } },
    orderBy: { createdAt: 'desc' as const },
  },
  defects: {
    include: { resolvedBy: { select: personSelect } },
    orderBy: { createdAt: 'desc' as const },
  },
};

function personName(person: Person | null | undefined): string | undefined {
  if (!person) return undefined;
  return `${person.firstName} ${person.lastName}`.trim();
}

export function toAllocationRow(allocation: PresentableAllocation): AllocationRow {
  return {
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
  };
}

function presentAllocation(allocation: PresentableAllocation, today: string) {
  const row = toAllocationRow(allocation);
  return {
    id: allocation.id,
    vehicle_id: allocation.vehicleId,
    user_id: allocation.userId,
    user_name: personName(allocation.user),
    project_id: allocation.projectId ?? undefined,
    project_name: allocation.project?.name,
    start_date: row.startDate,
    end_date: row.endDate ?? undefined,
    until_further_notice: row.endDate == null,
    assigned_by_user_id: allocation.assignedByUserId,
    assigned_by_name: personName(allocation.assignedBy),
    assigned_at: allocation.assignedAt.toISOString(),
    ended_at: allocation.endedAt?.toISOString(),
    ended_by_user_id: allocation.endedByUserId ?? undefined,
    active: isActiveAllocation(row, today),
  };
}

function presentCheck(check: PresentableCheck) {
  return {
    id: check.id,
    vehicle_id: check.vehicleId,
    user_id: check.userId,
    user_name: personName(check.user),
    mileage: check.mileage,
    has_defects: check.hasDefects,
    unsafe: check.unsafe,
    result: check.result,
    notes: check.notes ?? undefined,
    checked_on: isoDateFromDb(check.checkedOn),
    created_at: check.createdAt.toISOString(),
  };
}

function presentDefect(defect: PresentableDefect) {
  return {
    id: defect.id,
    vehicle_id: defect.vehicleId,
    check_id: defect.checkId,
    notes: defect.notes,
    status: defect.status,
    resolved_by_user_id: defect.resolvedByUserId ?? undefined,
    resolved_by_name: personName(defect.resolvedBy),
    resolved_at: defect.resolvedAt?.toISOString(),
    resolution_notes: defect.resolutionNotes ?? undefined,
    created_at: defect.createdAt.toISOString(),
  };
}

function latestTodayCheck(checks: PresentableCheck[], today: string): PresentableCheck | null {
  return (
    checks
      .filter((check) => isoDateFromDb(check.checkedOn) === today)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
  );
}

export function presentVehicle(vehicle: PresentableVehicle, today: string, mode: 'summary' | 'detail') {
  const rows = vehicle.allocations.map(toAllocationRow);
  const current = activeAllocations(rows, today)[0] ?? null;
  const currentRecord = current ? vehicle.allocations.find((allocation) => allocation.id === current.id) : undefined;
  const openDefects = vehicle.defects.filter((defect) => defect.status === 'open');
  const todayCheck = latestTodayCheck(vehicle.checks, today);
  const todayDefect = todayCheck ? vehicle.defects.find((defect) => defect.checkId === todayCheck.id) : undefined;
  const compliance: ExpiryAssessment = assessExpiry(
    {
      motDue: isoDateFromDb(vehicle.motDue),
      roadTaxDue: isoDateFromDb(vehicle.roadTaxDue),
      insuranceExpiry: isoDateFromDb(vehicle.insuranceExpiry),
      serviceDueDate: isoDateFromDb(vehicle.serviceDueDate),
      serviceDueMileage: vehicle.serviceDueMileage,
      currentMileage: vehicle.currentMileage,
    },
    today
  );
  const shared = {
    status: vehicle.status,
    motDue: isoDateFromDb(vehicle.motDue),
    roadTaxDue: isoDateFromDb(vehicle.roadTaxDue),
    insuranceExpiry: isoDateFromDb(vehicle.insuranceExpiry),
    openDefects: openDefects.map((defect) => ({ id: defect.id })),
    todayCheck: todayCheck
      ? {
          result: todayCheck.result,
          unsafe: todayCheck.unsafe,
          resolved: todayDefect?.status === 'resolved',
        }
      : null,
    today,
  };
  const allocateBlockReasons: BlockReason[] = vehicle.archivedAt
    ? []
    : vehicleBlockReasons({ ...shared, purpose: 'allocate' });
  const blockReasons: BlockReason[] = vehicle.archivedAt
    ? []
    : vehicleBlockReasons({ ...shared, purpose: 'use' });

  return {
    id: vehicle.id,
    company_id: vehicle.companyId,
    registration: vehicle.registration,
    registration_display: formatRegistration(vehicle.registration),
    make: vehicle.make,
    model: vehicle.model,
    type: vehicle.type,
    colour: vehicle.colour,
    fuel_type: vehicle.fuelType,
    vin: vehicle.vin ?? undefined,
    mot_due: isoDateFromDb(vehicle.motDue) ?? undefined,
    road_tax_due: isoDateFromDb(vehicle.roadTaxDue) ?? undefined,
    insurance_expiry: isoDateFromDb(vehicle.insuranceExpiry) ?? undefined,
    service_due_date: isoDateFromDb(vehicle.serviceDueDate) ?? undefined,
    service_due_mileage: vehicle.serviceDueMileage ?? undefined,
    current_mileage: vehicle.currentMileage ?? undefined,
    notes: vehicle.notes ?? undefined,
    status: vehicle.status,
    photo_url: vehicle.photoUrl ?? undefined,
    project_id: vehicle.projectId ?? undefined,
    project_name: vehicle.project?.name,
    archived_at: vehicle.archivedAt?.toISOString(),
    created_at: vehicle.createdAt.toISOString(),
    updated_at: vehicle.updatedAt.toISOString(),
    compliance,
    block_reasons: blockReasons,
    allocate_block_reasons: allocateBlockReasons,
    usable_today: !vehicle.archivedAt && blockReasons.length === 0,
    allocatable: !vehicle.archivedAt && allocateBlockReasons.length === 0,
    current_allocation: currentRecord ? presentAllocation(currentRecord, today) : undefined,
    today_check: todayCheck ? presentCheck(todayCheck) : undefined,
    open_defects: openDefects.map(presentDefect),
    ...(mode === 'detail'
      ? {
          allocations: vehicle.allocations.map((allocation) => presentAllocation(allocation, today)),
          checks: vehicle.checks.map(presentCheck),
          defects: vehicle.defects.map(presentDefect),
        }
      : {}),
  };
}
