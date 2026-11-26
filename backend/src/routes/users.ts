import { Router } from 'express';
import bcrypt from 'bcrypt';
import type { UserRole } from '@prisma/client';
import { prisma } from '../db';
import type { AuthedRequest } from '../middleware/auth';
import { authMiddleware, effectiveRole } from '../middleware/auth';
import * as S from '../lib/serialize';
import { claimEmail, freedEmail } from '../lib/userEmail';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req: AuthedRequest, res) => {
  const query = String(req.query.query ?? '').trim();
  const role = String(req.query.role ?? '').trim();
  const targetCompanyId = String(req.query.company_id ?? req.query.companyId ?? '').trim();
  const activeOnly = req.query.active_only === 'true';
  const search =
    query.length > 0
      ? {
          OR: [
            { email: { contains: query, mode: 'insensitive' as const } },
            { firstName: { contains: query, mode: 'insensitive' as const } },
            { lastName: { contains: query, mode: 'insensitive' as const } },
          ],
        }
      : {};
  const where =
    req.userRole === 'superadmin'
      ? {
          deletedAt: null,
          ...(targetCompanyId ? { companyId: targetCompanyId } : {}),
          ...(role ? { role: role as UserRole } : {}),
          ...(activeOnly ? { isActive: true } : {}),
          ...search,
        }
      : {
          companyId: req.companyId!,
          deletedAt: null,
          ...(role ? { role: role as UserRole } : {}),
          ...(activeOnly ? { isActive: true } : {}),
          ...search,
        };
  const users = await prisma.user.findMany({ where, orderBy: { createdAt: 'desc' } });
  res.json(users.map(S.user));
});

router.get('/admins', async (req: AuthedRequest, res) => {
  const targetCompanyId = String(req.query.company_id ?? req.query.companyId ?? '').trim();
  const where =
    req.userRole === 'superadmin'
      ? {
          role: 'admin' as UserRole,
          deletedAt: null,
          ...(targetCompanyId ? { companyId: targetCompanyId } : {}),
        }
      : {
          role: 'admin' as UserRole,
          companyId: req.companyId!,
          deletedAt: null,
        };
  const admins = await prisma.user.findMany({
    where,
    orderBy: [{ companyId: 'asc' }, { createdAt: 'desc' }],
  });
  const memberships = await prisma.companyMembership.findMany({
    where: { userId: { in: admins.map((u) => u.id) } },
    include: { company: true },
  });
  const byUser = new Map<string, { id: string; name: string }[]>();
  for (const m of memberships) {
    const existing = byUser.get(m.userId) ?? [];
    existing.push({ id: m.company.id, name: m.company.name });
    byUser.set(m.userId, existing);
  }
  res.json(
    admins.map((u) => ({
      ...S.user(u),
      companies: byUser.get(u.id) ?? [],
    }))
  );
});

router.get('/email/:email', async (req: AuthedRequest, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.deletedAt != null) return res.status(404).json({ error: 'Not found' });
  if (req.userRole !== 'superadmin' && user.companyId !== req.companyId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(S.user(user));
});

router.get('/:id', async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user || user.deletedAt != null) return res.status(404).json({ error: 'Not found' });
  if (req.userRole !== 'superadmin' && user.companyId !== req.companyId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(S.user(user));
});

router.post('/', async (req: AuthedRequest, res) => {
  if (!['admin', 'superadmin'].includes(effectiveRole(req))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const body = req.body ?? {};
  const email = String(body.email ?? '').toLowerCase().trim();
  const password = body.password;
  const photoUrl = String(body.photo_url ?? body.photoUrl ?? '').trim();
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  let companyId = body.company_id ?? body.companyId ?? req.companyId;
  if (req.userRole !== 'superadmin') {
    companyId = req.companyId;
  }
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  // A deleted user's email is freed so the same address can be used again.
  if (await claimEmail(email)) {
    return res.status(409).json({ error: 'A user with this email already exists.' });
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const role = (body.role ?? 'staff') as UserRole;
  if (role === 'superadmin') {
    return res.status(403).json({ error: 'Superadmin cannot be created from this endpoint' });
  }
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: String(body.first_name ?? body.firstName ?? 'User'),
      lastName: String(body.last_name ?? body.lastName ?? ''),
      role,
      companyId,
      photoUrl: photoUrl || undefined,
      isActive: body.is_active ?? body.isActive ?? true,
    },
  });
  await prisma.companyMembership.create({
    data: { userId: user.id, companyId, role },
  });
  res.status(201).json(S.user(user));
});

router.put('/:id', async (req: AuthedRequest, res) => {
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (req.userRole !== 'superadmin' && existing.companyId !== req.companyId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!['admin', 'superadmin'].includes(effectiveRole(req)) && req.userId !== existing.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const body = req.body ?? {};
  if (body.role === 'superadmin' && req.userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...(body.first_name != null && { firstName: String(body.first_name) }),
      ...(body.last_name != null && { lastName: String(body.last_name) }),
      ...(body.email != null && { email: String(body.email).toLowerCase() }),
      ...(body.role != null &&
        ['admin', 'superadmin'].includes(effectiveRole(req)) && {
          role: body.role,
        }),
      ...(body.is_active != null && { isActive: Boolean(body.is_active) }),
      ...(body.photo_url != null && String(body.photo_url).trim() && { photoUrl: String(body.photo_url).trim() }),
      ...(body.must_change_password != null &&
        ['admin', 'superadmin'].includes(effectiveRole(req)) && {
          mustChangePassword: Boolean(body.must_change_password),
        }),
      ...(body.password && {
        passwordHash: await bcrypt.hash(String(body.password), 10),
      }),
    },
  });
  if (body.role != null && ['admin', 'superadmin'].includes(effectiveRole(req)) && existing.companyId) {
    await prisma.companyMembership.update({
      where: {
        userId_companyId: { userId: user.id, companyId: existing.companyId },
      },
      data: { role: user.role },
    });
  }
  res.json(S.user(user));
});

router.delete('/:id', async (req: AuthedRequest, res) => {
  if (!['admin', 'superadmin'].includes(effectiveRole(req))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (req.userRole !== 'superadmin' && existing.companyId !== req.companyId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await prisma.user.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date(), email: freedEmail(existing.email, existing.id) },
  });
  res.status(204).send();
});

export default router;
