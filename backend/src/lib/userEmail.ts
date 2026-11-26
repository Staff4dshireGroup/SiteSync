import { prisma } from '../db';

/**
 * Deleted users are kept (soft delete) but their email column is unique, which
 * would block re-using the address. Rename the deleted row's email so the
 * original address is free. The original stays readable in the new value.
 */
export function freedEmail(email: string, id: string): string {
  return `deleted+${id}+${email}`;
}

/**
 * If `email` belongs to a soft-deleted user, free it up.
 * Returns the user still holding the email (an active one), or null if the email is available.
 */
export async function claimEmail(email: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) return null;
  if (existing.deletedAt == null) return existing;
  await prisma.user.update({
    where: { id: existing.id },
    data: { email: freedEmail(existing.email, existing.id) },
  });
  return null;
}
