import { Router } from 'express';
import bcrypt from 'bcrypt';
import type { UserRole } from '@prisma/client';
import { prisma } from '../db';
import { signToken, authMiddleware, type AuthedRequest } from '../middleware/auth';
import * as S from '../lib/serialize';
import { claimEmail } from '../lib/userEmail';

const router = Router();
const normalizeToken = (raw: string) => raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

function mapInvitationRole(role: UserRole, mapping: 'strict' | 'invite_link'): UserRole {
  if (mapping === 'strict') return role;
  if (role === 'admin') return 'admin';
  return 'supervisor';
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!user || !user.isActive || user.deletedAt != null) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  const token = signToken(user.id);
  return res.json({ user: S.user(updated), token });
});

/** Public: complete registration with a company invitation token (aligns with Flutter UserProvider.addUser + mark used). */
router.post('/register-invitation', async (req, res) => {
  const body = req.body ?? {};
  const rawToken = String(body.token ?? '').trim();
  const password = body.password;
  const first_name = body.first_name ?? body.firstName;
  const last_name = body.last_name ?? body.lastName;
  const emailInput = body.email != null ? String(body.email).toLowerCase().trim() : undefined;
  const photo_url = body.photo_url ?? body.photoUrl;
  const role_mapping: 'strict' | 'invite_link' =
    body.role_mapping === 'invite_link' || body.roleMapping === 'invite_link' ? 'invite_link' : 'strict';

  if (!rawToken || !password || !first_name || !last_name) {
    return res.status(400).json({ error: 'token, password, first_name, last_name required' });
  }

  const token = normalizeToken(rawToken);
  const invitation = await prisma.companyInvitation.findUnique({
    where: { token },
  });
  if (!invitation) {
    return res.status(404).json({ error: 'Invalid or expired invitation' });
  }
  if (invitation.usedAt) {
    return res.status(400).json({ error: 'Invitation already used' });
  }
  if (invitation.expiresAt < new Date()) {
    return res.status(400).json({ error: 'Invitation expired' });
  }

  const inviteEmail = invitation.email.toLowerCase();
  if (emailInput && emailInput !== inviteEmail) {
    return res.status(400).json({ error: 'Email does not match invitation' });
  }

  const existing = await claimEmail(inviteEmail);
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const role = mapInvitationRole(invitation.role, role_mapping);

  const created = await prisma.user.create({
    data: {
      email: inviteEmail,
      passwordHash,
      firstName: String(first_name),
      lastName: String(last_name),
      companyId: invitation.companyId,
      role,
      photoUrl: photo_url ?? undefined,
      mustChangePassword: false,
      lastLoginAt: new Date(),
    },
  });

  await prisma.companyMembership.create({
    data: { userId: created.id, companyId: invitation.companyId, role },
  });

  await prisma.companyInvitation.update({
    where: { id: invitation.id },
    data: { usedAt: new Date() },
  });

  await prisma.onboardingRecord.upsert({
    where: { userId: created.id },
    create: { userId: created.id, status: 'pending' },
    update: {},
  });

  const tokenJwt = signToken(created.id);
  return res.status(201).json({ user: S.user(created), token: tokenJwt });
});

router.post('/change-password', authMiddleware, async (req: AuthedRequest, res) => {
  const body = req.body ?? {};
  const current = body.current_password ?? body.currentPassword;
  const next = body.new_password ?? body.newPassword;

  if (!next || String(next).length < 6) {
    return res.status(400).json({ error: 'new_password required (min 6 characters)' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: 'Not found' });

  if (!current) {
    return res.status(400).json({ error: 'current_password required' });
  }
  const ok = await bcrypt.compare(String(current), user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Current password incorrect' });

  const passwordHash = await bcrypt.hash(String(next), 10);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });
  return res.json({ user: S.user(updated) });
});

router.post('/register', async (req, res) => {
  const body = req.body ?? {};
  const email = String(body.email ?? '').toLowerCase().trim();
  const password = body.password;
  const first_name = body.first_name ?? body.firstName;
  const last_name = body.last_name ?? body.lastName;
  let company_id = body.company_id ?? body.companyId;

  if (!email || !password || !first_name || !last_name) {
    return res.status(400).json({ error: 'email, password, first_name, last_name required' });
  }

  const existing = await claimEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  if (!company_id) {
    const company = await prisma.company.create({
      data: { name: `${first_name} ${last_name}'s organisation` },
    });
    company_id = company.id;
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const created = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: String(first_name),
      lastName: String(last_name),
      companyId: company_id,
      role: 'admin',
    },
  });
  await prisma.companyMembership.create({
    data: { userId: created.id, companyId: company_id, role: 'admin' },
  });
  const user = await prisma.user.update({
    where: { id: created.id },
    data: { lastLoginAt: new Date() },
  });

  const token = signToken(user.id);
  return res.status(201).json({ user: S.user(user), token });
});

export default router;
