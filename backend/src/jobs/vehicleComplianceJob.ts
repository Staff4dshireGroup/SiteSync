import type { PrismaClient } from '@prisma/client';
import type { Server as IoServer } from 'socket.io';
import { notifyVehicleCompliance } from '../vehicles/reminders';

/**
 * Daily compliance reminders for company admins.
 * Set VEHICLE_COMPLIANCE_JOB=false to disable. Skipped when NODE_ENV=test.
 */
export function startVehicleComplianceJob(prisma: PrismaClient, io: IoServer | undefined): void {
  if (process.env.VEHICLE_COMPLIANCE_JOB === 'false' || process.env.NODE_ENV === 'test') {
    return;
  }
  const intervalMs = Number(process.env.VEHICLE_COMPLIANCE_INTERVAL_MS) || 24 * 60 * 60 * 1000;

  const run = async () => {
    try {
      const count = await notifyVehicleCompliance(prisma, io);
      if (count) console.log(`[vehicle-compliance] notified for ${count} vehicle(s)`);
    } catch (e) {
      console.error('[vehicle-compliance]', (e as Error).message);
    }
  };

  setInterval(run, intervalMs);
  setTimeout(run, 60_000);
}
