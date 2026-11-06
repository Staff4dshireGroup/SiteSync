import type { Server as IoServer } from 'socket.io';
import type { PrismaClient } from '@prisma/client';
import { createNotification } from '../lib/createNotification';
import { onboardingReminderJobEnabled } from '../lib/runtimePolicy';

/**
 * Periodically remind staff/supervisors with incomplete onboarding (no completed_at).
 * Requires ONBOARDING_REMINDER_JOB=true and the process must not be read-only.
 */
export function startOnboardingReminderJob(prisma: PrismaClient, io: IoServer | undefined): void {
  if (!onboardingReminderJobEnabled()) {
    return;
  }
  const intervalMs = Number(process.env.ONBOARDING_REMINDER_INTERVAL_MS) || 24 * 60 * 60 * 1000;
  const cooldownDays = Number(process.env.ONBOARDING_AUTO_REMINDER_COOLDOWN_DAYS ?? 7);
  const minAgeHours = Number(process.env.ONBOARDING_MIN_AGE_HOURS_BEFORE_REMINDER ?? 24);

  const run = async () => {
    try {
      const minCreated = new Date(Date.now() - Math.max(1, minAgeHours) * 60 * 60 * 1000);
      const lastRemindBefore = new Date(Date.now() - Math.max(1, cooldownDays) * 24 * 60 * 60 * 1000);
      const pending = await prisma.onboardingRecord.findMany({
        where: {
          completedAt: null,
          createdAt: { lt: minCreated },
          user: {
            isActive: true,
            role: { in: ['staff', 'supervisor'] },
          },
          OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: lastRemindBefore } }],
        },
        select: { id: true, userId: true },
      });
      for (const row of pending) {
        await createNotification(prisma, io, {
          userId: row.userId,
          title: 'Complete your onboarding',
          body: 'Your onboarding is still outstanding. Please complete the forms in the app.',
          type: 'warning',
          actionRoute: 'Onboarding',
        });
        await prisma.onboardingRecord.update({
          where: { id: row.id },
          data: { lastReminderAt: new Date() },
        });
      }
      if (pending.length) {
        console.log(`[onboarding-reminder] sent ${pending.length} reminder(s)`);
      }
    } catch (e) {
      console.error('[onboarding-reminder]', (e as Error).message);
    }
  };

  setInterval(run, intervalMs);
  setTimeout(run, 60_000);
}
