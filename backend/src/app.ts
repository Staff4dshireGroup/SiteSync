import path from 'path';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { corsOrigin } from './corsConfig';
import {
  onboardingReminderJobEnabled,
  pushOnApprovalEnabled,
  readOnlyMode,
  tokenRefreshJobEnabled,
} from './lib/runtimePolicy';
import authRoutes from './routes/auth';
import usersRoutes from './routes/users';
import companiesRoutes from './routes/companies';
import projectsRoutes from './routes/projects';
import timesheetsRoutes from './routes/timesheets';
import chatRoutes from './routes/chat';
import notificationsRoutes from './routes/notifications';
import jobCompletionsRoutes from './routes/jobCompletions';
import incidentsRoutes from './routes/incidents';
import onboardingRoutes from './routes/onboarding';
import uploadsRoutes from './routes/uploads';
import companyInvitationsRoutes from './routes/company-invitations';
import xeroRoutes from './routes/xero';
import pushRoutes from './routes/push';
import governanceRoutes from './routes/governance';
import placesRoutes from './routes/places';
import trashRoutes from './routes/trash';

export function createApp() {
  const app = express();
  app.use(
    cors({
      origin: corsOrigin(),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'sitesync-api',
      read_only: readOnlyMode(),
      jobs: {
        xero_token_refresh: tokenRefreshJobEnabled(),
        onboarding_reminder: onboardingReminderJobEnabled(),
        xero_push_on_approval: pushOnApprovalEnabled(),
      },
    });
  });

  app.use((req, res, next) => {
    if (!readOnlyMode()) return next();
    res.status(503).json({
      error: 'read_only',
      message: 'This SiteSync instance is in staging read-only mode and will not serve or write application data.',
    });
  });

  const uploadsRoot = path.join(process.cwd(), 'uploads');
  app.use('/files', express.static(uploadsRoot));

  // Match mobile client paths (baseURL is /api, not /api/auth)
  app.post('/api/password-reset/request', (_req, res) => {
    res.json({ ok: true, message: 'If implemented, an email would be sent.' });
  });
  app.post('/api/password-reset/reset', (_req, res) => {
    res.json({ ok: true, message: 'Password reset not implemented in this template.' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/company-invitations', companyInvitationsRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/companies', companiesRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/timesheets', timesheetsRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/job-completions', jobCompletionsRoutes);
  app.use('/api/incidents', incidentsRoutes);
  app.use('/api/onboarding', onboardingRoutes);
  app.use('/api/uploads', uploadsRoutes);
  app.use('/api/xero', xeroRoutes);
  app.use('/api/push', pushRoutes);
  app.use('/api/governance', governanceRoutes);
  app.use('/api/places', placesRoutes);
  app.use('/api/trash', trashRoutes);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled route error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
