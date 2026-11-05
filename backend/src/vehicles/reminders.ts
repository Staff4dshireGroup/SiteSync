import type { PrismaClient } from '@prisma/client';
import type { Server as IoServer } from 'socket.io';
import { createNotification } from '../lib/createNotification';
import { dbDateFromIso, isoDateFromDb, londonToday } from './dates';
import { assessExpiry } from './expiry';
import { formatRegistration } from './registration';

/**
 * Notify company admins about vehicles with MOT, tax, insurance, or service
 * due within 30 days or overdue. At most once per vehicle per London day.
 */
export async function notifyVehicleCompliance(
  prisma: PrismaClient,
  io: IoServer | undefined,
  opts?: { vehicleId?: string }
): Promise<number> {
  const today = londonToday();
  const todayDate = dbDateFromIso(today);
  const vehicles = await prisma.vehicle.findMany({
    where: {
      archivedAt: null,
      ...(opts?.vehicleId ? { id: opts.vehicleId } : {}),
      OR: [{ complianceNotifiedOn: null }, { complianceNotifiedOn: { lt: todayDate } }],
    },
  });

  const adminsByCompany = new Map<string, string[]>();
  const adminsFor = async (companyId: string): Promise<string[]> => {
    const cached = adminsByCompany.get(companyId);
    if (cached) return cached;
    const [memberships, users] = await Promise.all([
      prisma.companyMembership.findMany({
        where: { companyId, role: 'admin' },
        select: { userId: true },
      }),
      prisma.user.findMany({
        where: { companyId, role: 'admin', deletedAt: null, isActive: true },
        select: { id: true },
      }),
    ]);
    const ids = [...new Set([...memberships.map((row) => row.userId), ...users.map((row) => row.id)])];
    adminsByCompany.set(companyId, ids);
    return ids;
  };

  let notified = 0;
  for (const vehicle of vehicles) {
    const assessment = assessExpiry(
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
    const lines = assessment.items.flatMap((item) => (item.message ? [item.message] : []));
    if (!assessment.has_warning || lines.length === 0) continue;

    const adminIds = await adminsFor(vehicle.companyId);
    if (adminIds.length === 0) continue;

    const registration = formatRegistration(vehicle.registration);
    for (const userId of adminIds) {
      await createNotification(prisma, io, {
        userId,
        title: `Vehicle ${registration}`,
        body: lines.join('. '),
        type: 'warning',
        actionRoute: 'Vehicles',
        actionParams: { screen: 'VehicleDetail', params: { vehicleId: vehicle.id } },
      });
    }
    await prisma.vehicle.update({
      where: { id: vehicle.id },
      data: { complianceNotifiedOn: todayDate },
    });
    notified += 1;
  }
  return notified;
}
