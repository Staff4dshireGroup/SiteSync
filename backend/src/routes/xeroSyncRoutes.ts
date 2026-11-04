import type { Router } from 'express';
import type { AuthedRequest } from '../middleware/auth';
import { prisma } from '../db';
import { resolveCompanyId, assertCompanyAdmin, sendXeroError } from '../lib/xeroAccess';
import {
  createAndLinkProject,
  httpStatusOf,
  linkProjectManually,
  listProjectLinks,
  matchAllProjectsByPrefix,
  matchProjectByPrefix,
  pullContacts,
  pullProjects,
  pullUsers,
  setDefaultXeroUser,
  unlinkProject,
} from '../services/xeroProjectSync';
import { getCompanyXeroSummary, pushApprovedTime } from '../services/xeroTimeSync';

function companyFrom(req: AuthedRequest): string | null {
  const source = req.method === 'GET' ? (req.query as { company_id?: string }) : (req.body ?? {});
  return resolveCompanyId(req, source);
}

export function registerXeroSyncRoutes(router: Router): void {
  router.get('/projects', async (req: AuthedRequest, res) => {
    const companyId = companyFrom(req);
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    if (!(await assertCompanyAdmin(req, companyId))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const states = (req.query.states as string | undefined)?.trim() || 'INPROGRESS';
      const projects = await pullProjects(companyId, req.userId, states);
      res.json({ projects });
    } catch (e) {
      sendXeroError(res, e);
    }
  });

  router.get('/contacts', async (req: AuthedRequest, res) => {
    const companyId = companyFrom(req);
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    if (!(await assertCompanyAdmin(req, companyId))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const search = (req.query.search as string | undefined)?.trim();
      const contacts = await pullContacts(companyId, search, req.userId);
      res.json({ contacts });
    } catch (e) {
      sendXeroError(res, e);
    }
  });

  router.get('/users', async (req: AuthedRequest, res) => {
    const companyId = companyFrom(req);
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    if (!(await assertCompanyAdmin(req, companyId))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const users = await pullUsers(companyId, req.userId);
      res.json({ users });
    } catch (e) {
      sendXeroError(res, e);
    }
  });

  router.put('/settings', async (req: AuthedRequest, res) => {
    const companyId = companyFrom(req);
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    if (!(await assertCompanyAdmin(req, companyId))) return res.status(403).json({ error: 'Forbidden' });
    const raw = req.body?.default_xero_user_id ?? req.body?.defaultXeroUserId;
    const userId = raw == null || String(raw).trim() === '' ? null : String(raw).trim();
    try {
      const settings = await setDefaultXeroUser(companyId, userId, req.userId);
      res.json({ ok: true, ...settings });
    } catch (e) {
      const status = httpStatusOf(e);
      if (status) return res.status(status).json({ error: (e as Error).message });
      sendXeroError(res, e);
    }
  });

  router.get('/projects/links', async (req: AuthedRequest, res) => {
    const companyId = companyFrom(req);
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    if (!(await assertCompanyAdmin(req, companyId))) return res.status(403).json({ error: 'Forbidden' });
    const projectId = (req.query.project_id as string | undefined)?.trim();
    const projects = await listProjectLinks(companyId, projectId || undefined);
    res.json({ projects });
  });

  router.post('/projects/link', async (req: AuthedRequest, res) => {
    const companyId = companyFrom(req);
    const projectId = String(req.body?.project_id ?? req.body?.projectId ?? '');
    const xeroProjectId = String(req.body?.xero_project_id ?? req.body?.xeroProjectId ?? '');
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    if (!projectId || !xeroProjectId) return res.status(400).json({ error: 'project_id and xero_project_id required' });
    if (!(await assertCompanyAdmin(req, companyId))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const link = await linkProjectManually({ companyId, projectId, xeroProjectId, userId: req.userId });
      res.json({
        ok: true,
        project_id: link.projectId,
        xero_project_id: link.xeroProjectId,
        xero_project_name: link.xeroProjectName,
        method: link.method,
      });
    } catch (e) {
      const status = httpStatusOf(e);
      if (status) return res.status(status).json({ error: (e as Error).message });
      sendXeroError(res, e);
    }
  });

  router.post('/projects/match', async (req: AuthedRequest, res) => {
    const companyId = companyFrom(req);
    const projectId = String(req.body?.project_id ?? req.body?.projectId ?? '');
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    if (!projectId) return res.status(400).json({ error: 'project_id required' });
    if (!(await assertCompanyAdmin(req, companyId))) return res.status(403).json({ error: 'Forbidden' });
    const apply = req.body?.apply !== false && req.body?.apply !== 'false';
    try {
      const result = await matchProjectByPrefix({ companyId, projectId, userId: req.userId, apply });
      res.json(result);
    } catch (e) {
      const status = httpStatusOf(e);
      if (status) return res.status(status).json({ error: (e as Error).message });
      sendXeroError(res, e);
    }
  });

  router.post('/projects/match-all', async (req: AuthedRequest, res) => {
    const companyId = companyFrom(req);
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    if (!(await assertCompanyAdmin(req, companyId))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const result = await matchAllProjectsByPrefix(companyId, req.userId);
      res.json(result);
    } catch (e) {
      sendXeroError(res, e);
    }
  });

  router.post('/projects/create', async (req: AuthedRequest, res) => {
    const companyId = companyFrom(req);
    const projectId = String(req.body?.project_id ?? req.body?.projectId ?? '');
    const contactId = String(req.body?.contact_id ?? req.body?.contactId ?? '');
    const name = req.body?.name != null ? String(req.body.name) : undefined;
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    if (!projectId || !contactId) return res.status(400).json({ error: 'project_id and contact_id required' });
    if (!(await assertCompanyAdmin(req, companyId))) return res.status(403).json({ error: 'Forbidden' });
    try {
      const created = await createAndLinkProject({ companyId, projectId, contactId, name, userId: req.userId });
      res.status(201).json({
        ok: true,
        project_id: created.link.projectId,
        xero_project_id: created.link.xeroProjectId,
        xero_project_name: created.link.xeroProjectName,
        xero_task_id: created.task_id,
        method: created.link.method,
        suggested_name: created.suggested_name,
      });
    } catch (e) {
      const status = httpStatusOf(e);
      if (status) return res.status(status).json({ error: (e as Error).message });
      sendXeroError(res, e);
    }
  });

  router.delete('/projects/link', async (req: AuthedRequest, res) => {
    const companyId = resolveCompanyId(req, { ...(req.body ?? {}), ...(req.query as { company_id?: string }) });
    const projectId = String(req.body?.project_id ?? req.body?.projectId ?? req.query.project_id ?? '');
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    if (!projectId) return res.status(400).json({ error: 'project_id required' });
    if (!(await assertCompanyAdmin(req, companyId))) return res.status(403).json({ error: 'Forbidden' });
    try {
      await unlinkProject(companyId, projectId, req.userId);
      res.json({ ok: true, project_id: projectId });
    } catch (e) {
      const status = httpStatusOf(e);
      if (status) return res.status(status).json({ error: (e as Error).message });
      sendXeroError(res, e);
    }
  });

  router.post('/time/push', async (req: AuthedRequest, res) => {
    const companyId = companyFrom(req);
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    if (!(await assertCompanyAdmin(req, companyId))) return res.status(403).json({ error: 'Forbidden' });
    const projectId = req.body?.project_id ?? req.body?.projectId;
    const timeEntryId = req.body?.time_entry_id ?? req.body?.timeEntryId;
    try {
      const pushed = await pushApprovedTime({
        companyId,
        actorUserId: req.userId,
        projectId: projectId ? String(projectId) : undefined,
        timeEntryId: timeEntryId ? String(timeEntryId) : undefined,
      });
      const summary = await getCompanyXeroSummary(companyId);
      res.json({ ...pushed, ...summary });
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('projects scope')) {
        return res.status(400).json({ error: 'missing_projects_scope', message });
      }
      sendXeroError(res, e);
    }
  });

  router.get('/time/status', async (req: AuthedRequest, res) => {
    const companyId = companyFrom(req);
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    if (!(await assertCompanyAdmin(req, companyId))) return res.status(403).json({ error: 'Forbidden' });
    const summary = await getCompanyXeroSummary(companyId);
    res.json({ company_id: companyId, ...summary });
  });

  router.get('/audit', async (req: AuthedRequest, res) => {
    const companyId = companyFrom(req);
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    if (!(await assertCompanyAdmin(req, companyId))) return res.status(403).json({ error: 'Forbidden' });
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const logs = await prisma.xeroAuditLog.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({
      logs: logs.map((row) => ({
        id: row.id,
        action: row.action,
        detail: row.detail,
        meta: row.meta,
        created_at: row.createdAt.toISOString(),
        user_id: row.userId,
      })),
    });
  });
}
